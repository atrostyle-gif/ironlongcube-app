import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";
import { getDropboxAccessToken } from "./lib/dropboxAuth";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DROPBOX_PATH = "/ironlongcube/bom.json";

type BomItem = {
  model_id?: string;
  model: string;
  size?: string;
  stage: number;
  length_mm: number;
  tap: boolean;
  qty_per_unit: number;
  confirmed?: boolean;
};

/** 既存データ互換: 読込時 tap が無ければ screw を tap として扱う */
function normalizeTap(item: { tap?: boolean; screw?: boolean }): boolean {
  if (typeof item.tap === "boolean") return item.tap;
  if (typeof item.screw === "boolean") return item.screw;
  return false;
}

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonBody(obj: object): string {
  return JSON.stringify(obj);
}

function extractDropboxErrorDetail(err: unknown): string {
  const anyErr = err as any;
  const parts: string[] = [];
  if (anyErr?.status) parts.push(`status=${anyErr.status}`);
  if (anyErr?.error_summary) parts.push(`error_summary=${anyErr.error_summary}`);
  if (anyErr?.error) {
    try {
      parts.push(`error=${JSON.stringify(anyErr.error)}`);
    } catch {
      parts.push("error=[unserializable]");
    }
  }
  if (anyErr?.response) {
    const resp = anyErr.response;
    if (resp.status) parts.push(`response.status=${resp.status}`);
    if (resp.data) {
      try {
        parts.push(`response.data=${JSON.stringify(resp.data)}`);
      } catch {
        parts.push("response.data=[unserializable]");
      }
    }
  }
  return parts.join("; ") || "unknown Dropbox error";
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

  let token: string;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    const msg = (err as Error)?.message ?? "Failed to get Dropbox access token";
    console.error("bom: getDropboxAccessToken failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({
        ok: false,
        error: "Dropbox token error",
        detail: msg,
      }),
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
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
      const items: BomItem[] = rawItems
        .filter((i: unknown) => i != null && typeof i === "object")
        .map((i: Record<string, unknown>) => {
          const row = i as Record<string, unknown>;
          return {
            model_id: row.model_id,
            model: row.model,
            size: row.size,
            stage: row.stage,
            length_mm: row.length_mm,
            tap: normalizeTap(row as { tap?: boolean; screw?: boolean }),
            qty_per_unit: row.qty_per_unit,
            confirmed:
              typeof row.confirmed === "boolean" ? row.confirmed : false,
          } as BomItem;
        });
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
      console.error("bom GET error detail:", {
        status: (err as any)?.status,
        error: (err as any)?.error,
        responseStatus: (err as any)?.response?.status,
        responseData: (err as any)?.response?.data,
        error_summary: (err as any)?.error_summary,
      });
      const detail = extractDropboxErrorDetail(err);
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({
          ok: false,
          error: "Dropbox API error",
          detail:
            ((err as Error)?.message ?? "Failed to load BOM") + " | " + detail,
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
      items = rawItems
        .filter(
          (i: unknown) =>
            i != null &&
            typeof i === "object" &&
            typeof (i as BomItem).model === "string" &&
            typeof (i as BomItem).stage === "number" &&
            typeof (i as BomItem).length_mm === "number" &&
            (typeof (i as BomItem).tap === "boolean" ||
              typeof (i as { screw?: boolean }).screw === "boolean") &&
            typeof (i as BomItem).qty_per_unit === "number"
        )
        .map((i: Record<string, unknown>) => {
          const row = i as BomItem & { confirmed?: boolean };
          return {
            model_id: row.model_id,
            model: row.model,
            size: row.size,
            stage: row.stage,
            length_mm: row.length_mm,
            tap: normalizeTap(i as { tap?: boolean; screw?: boolean }),
            qty_per_unit: row.qty_per_unit,
            confirmed:
              typeof row.confirmed === "boolean" ? row.confirmed : false,
          } as BomItem;
        }) as BomItem[];
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
      console.error("bom POST error detail:", {
        status: (err as any)?.status,
        error: (err as any)?.error,
        responseStatus: (err as any)?.response?.status,
        responseData: (err as any)?.response?.data,
        error_summary: (err as any)?.error_summary,
      });
      const detail = extractDropboxErrorDetail(err);
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({
          ok: false,
          error: "Dropbox API error",
          detail:
            ((err as Error)?.message ?? "Failed to save BOM") + " | " + detail,
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
