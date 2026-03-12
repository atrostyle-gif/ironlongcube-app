import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";
import { getDropboxAccessToken } from "./lib/dropboxAuth";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DRAWINGS_JSON_PATH = "/ironlongcube/drawings.json";

export type Drawing = {
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonBody(obj: object): string {
  return JSON.stringify(obj);
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
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: jsonBody({ error: "Method not allowed" }),
    };
  }

  let token: string;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    const msg = (err as Error)?.message ?? "Failed to get Dropbox access token";
    console.error("drawings: getDropboxAccessToken failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ error: "Dropbox token error", detail: msg }),
    };
  }

  const dbx = new Dropbox({ accessToken: token });
  try {
    const res = await dbx.filesDownload({ path: DRAWINGS_JSON_PATH });
    const result = res.result as { fileBinary?: Buffer; fileBlob?: Blob };
    const raw = await getDownloadedFileAsText(result);
    const list = JSON.parse(raw) as Drawing[];
    const drawings = Array.isArray(list) ? list : [];
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: jsonBody({ drawings }),
    };
  } catch (err: unknown) {
    const e = err as { error?: { error?: { path?: { ".tag"?: string } } } };
    if (e?.error?.error?.path?.[".tag"] === "not_found") {
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: jsonBody({ drawings: [] }),
      };
    }
    console.error("drawings GET error:", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ error: "Failed to load drawings" }),
    };
  }
};
