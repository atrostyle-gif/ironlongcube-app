import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { Dropbox } from "dropbox";
import { getDropboxAccessToken } from "./lib/dropboxAuth";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DRAWINGS_FOLDER = "/ironlongcube/drawings";
const DRAWINGS_JSON_PATH = "/ironlongcube/drawings.json";

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg"]);
function getExt(filename: string, mime?: string): string {
  const lower = (filename || "").toLowerCase();
  const fromName = lower.split(".").pop();
  if (fromName && ALLOWED_EXT.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return "pdf";
}

type DrawingRecord = {
  model_id: string;
  size: string;
  stage: number;
  drawing_name: string;
  drawing_path: string;
};

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonBody(obj: object): string {
  return JSON.stringify(obj);
}

async function parseMultipart(
  event: { body?: string | null; isBase64Encoded?: boolean; headers?: Record<string, string> }
): Promise<{ model_id: string; size: string; stage: string; file: { buffer: Buffer; filename: string; mime?: string } } | { error: string }> {
  const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return { error: "Content-Type must be multipart/form-data" };
  }
  const body =
    event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

  return new Promise((resolve) => {
    const fields: Record<string, string> = {};
    let fileData: { buffer: Buffer; filename: string; mime?: string } | null = null;
    let finished = false;
    let fileCount = 0;

    const maybeResolve = () => {
      if (!finished || !fileData) return;
      const model_id = fields.model_id?.trim();
      const size = fields.size?.trim();
      const stage = fields.stage?.trim();
      if (!model_id || !size || !stage) {
        resolve({ error: "model_id, size, stage are required" });
        return;
      }
      resolve({ model_id, size, stage, file: fileData });
    };

    const bb = Busboy({ headers: { "content-type": contentType } });

    bb.on("field", (name, value) => {
      fields[name] = value;
    });
    bb.on("file", (_name, stream, info) => {
      fileCount++;
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.on("end", () => {
        fileData = {
          buffer: Buffer.concat(chunks),
          filename: filename || "drawing",
          mime: mimeType,
        };
        maybeResolve();
      });
    });
    bb.on("error", (err) => {
      console.error("busboy error", err);
      resolve({ error: "Invalid multipart body" });
    });
    bb.on("finish", () => {
      finished = true;
      if (fileCount === 0) {
        resolve({ error: "file is required" });
        return;
      }
      maybeResolve();
    });

    Readable.from(body).pipe(bb);
  });
}

async function getDownloadedFileAsText(
  result: { fileBinary?: Buffer; fileBlob?: Blob }
): Promise<string> {
  const data = result.fileBinary ?? result.fileBlob;
  if (!data) return "[]";
  if (Buffer.isBuffer(data)) return data.toString("utf-8");
  if (typeof (data as Blob).text === "function") {
    return await (data as Blob).text();
  }
  return "[]";
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: jsonHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: jsonBody({ error: "Method not allowed" }),
    };
  }

  const parsed = await parseMultipart(event);
  if ("error" in parsed) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: jsonBody({ success: false, error: parsed.error }),
    };
  }

  const { model_id, size, stage, file } = parsed;
  const stageNum = parseInt(stage, 10);
  if (isNaN(stageNum) || stageNum < 1) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: jsonBody({ success: false, error: "Invalid stage" }),
    };
  }

  const ext = getExt(file.filename, file.mime);
  const drawingName = `${model_id}_${size}_${stageNum}.${ext}`.replace(/[/\\]/g, "_");
  const drawingPath = `${DRAWINGS_FOLDER}/${drawingName}`;

  let token: string;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    const msg = (err as Error)?.message ?? "Failed to get Dropbox access token";
    console.error("upload-drawing: getDropboxAccessToken failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ success: false, error: msg }),
    };
  }

  const dbx = new Dropbox({ accessToken: token });

  try {
    await dbx.filesUpload({
      path: drawingPath,
      contents: file.buffer,
      mode: { ".tag": "overwrite" },
    });
  } catch (err) {
    console.error("upload-drawing: filesUpload failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ success: false, error: "Failed to upload file to Dropbox" }),
    };
  }

  let list: DrawingRecord[] = [];
  try {
    const res = await dbx.filesDownload({ path: DRAWINGS_JSON_PATH });
    const result = res.result as { fileBinary?: Buffer; fileBlob?: Blob };
    const raw = await getDownloadedFileAsText(result);
    list = JSON.parse(raw) as DrawingRecord[];
    if (!Array.isArray(list)) list = [];
  } catch (err: unknown) {
    const e = err as { error?: { error?: { path?: { ".tag"?: string } } } };
    if (e?.error?.error?.path?.[".tag"] !== "not_found") {
      console.error("upload-drawing: read drawings.json failed", err);
    }
  }

  const newEntry: DrawingRecord = {
    model_id,
    size,
    stage: stageNum,
    drawing_name: drawingName,
    drawing_path: drawingPath,
  };
  const idx = list.findIndex(
    (d) => d.model_id === model_id && d.size === size && d.stage === stageNum
  );
  if (idx >= 0) list[idx] = newEntry;
  else list.push(newEntry);

  try {
    await dbx.filesUpload({
      path: DRAWINGS_JSON_PATH,
      contents: JSON.stringify(list, null, 2),
      mode: { ".tag": "overwrite" },
    });
  } catch (err) {
    console.error("upload-drawing: save drawings.json failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ success: false, error: "Failed to save drawings.json" }),
    };
  }

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: jsonBody({ success: true }),
  };
};
