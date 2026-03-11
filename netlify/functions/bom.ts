import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DROPBOX_PATH = "/ironlongcube/bom.json";

type BomItem = {
  model_id?: string;
  model: string;
  size?: string;
  stage: number;
  length_mm: number;
  screw: boolean;
  qty_per_unit: number;
};

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonBody(obj: object): string {
  return JSON.stringify(obj);
}

async function getDownloadedFileAsText(
  result: { fileBinary?: Buffer; fileBlob?: Blob }
): Promise<string> {
  const data = result.fileBinary ?? result.fileBlob;
  if (!data) return "{}";
  if (Buffer.isBuffer(data)) return data.toString("utf-8");
  if (typeof (data as Blob).text === "function") {
    return await (data as Blob).text();
  }
  return "{}";
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: jsonHeaders, body: "" };
  }

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    console.error("bom: DROPBOX_ACCESS_TOKEN not set");
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "DROPBOX_ACCESS_TOKEN not set" }),
    };
  }

  const dbx = new Dropbox({ accessToken: token });

  if (event.httpMethod === "GET") {
    try {
      const res = await dbx.filesDownload({ path: DROPBOX_PATH });
      const result = res.result as { fileBinary?: Buffer; fileBlob?: Blob };
      const raw = await getDownloadedFileAsText(result);
      let parsed: { items?: unknown };
      try {
        parsed = JSON.parse(raw) as { items?: unknown };
      } catch (parseErr) {
        console.error("bom GET: invalid JSON in stored file", parseErr);
        return {
          statusCode: 500,
          headers: jsonHeaders,
          body: jsonBody({ ok: false, error: "Invalid JSON in stored file" }),
        };
      }
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: jsonBody({ items }),
      };
    } catch (err) {
      const e = err as { error?: { error?: { path?: { ".tag"?: string } } } };
      if (e?.error?.error?.path?.[".tag"] === "not_found") {
        return {
          statusCode: 200,
          headers: jsonHeaders,
          body: jsonBody({ items: [] }),
        };
      }
      console.error("bom GET error:", err);
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({
          ok: false,
          error: (err as Error)?.message ?? "Failed to load BOM",
        }),
      };
    }
  }

  if (event.httpMethod === "POST") {
    let items: BomItem[];
    try {
      const body = event.body ?? "{}";
      const parsed = JSON.parse(body) as { items?: unknown };
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
      items = rawItems.filter(
        (i): i is BomItem =>
          i != null &&
          typeof i === "object" &&
          typeof (i as BomItem).model === "string" &&
          typeof (i as BomItem).stage === "number" &&
          typeof (i as BomItem).length_mm === "number" &&
          typeof (i as BomItem).screw === "boolean" &&
          typeof (i as BomItem).qty_per_unit === "number"
      ) as BomItem[];
    } catch (parseErr) {
      console.error("bom POST: invalid JSON body", parseErr);
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: "Invalid JSON body" }),
      };
    }
    try {
      await dbx.filesUpload({
        path: DROPBOX_PATH,
        contents: JSON.stringify({ items }, null, 2),
        mode: { ".tag": "overwrite" },
      });
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: jsonBody({ ok: true }),
      };
    } catch (err) {
      console.error("bom POST error:", err);
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({
          ok: false,
          error: (err as Error)?.message ?? "Failed to save BOM",
        }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: jsonHeaders,
    body: jsonBody({ ok: false, error: "Method not allowed" }),
  };
};
