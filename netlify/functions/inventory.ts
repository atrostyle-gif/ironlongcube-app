import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";
import { getDropboxAccessToken } from "./lib/dropboxAuth";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Dropbox App Folder ルートの inventory.json（App タイプが App folder であること）
const DROPBOX_PATH = "/inventory.json";

type InvItem = {
  length_mm: number;
  tap: boolean;
  qty_on_hand: number;
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

/** Dropbox filesDownload の result から UTF-8 文字列を取得（fileBinary / fileBlob 両対応） */
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
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: "",
    };
  }

  let token: string;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    const msg = (err as Error)?.message ?? "Failed to get Dropbox access token";
    console.error("inventory: getDropboxAccessToken failed", err);
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
        console.error("inventory GET: invalid JSON in stored file", parseErr);
        return {
          statusCode: 500,
          headers: jsonHeaders,
          body: jsonBody({ ok: false, error: "Invalid JSON in stored file" }),
        };
      }

      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
      const items: InvItem[] = rawItems
        .filter((i: unknown) => i != null && typeof i === "object")
        .map((i: Record<string, unknown>) => ({
          length_mm: Number((i as InvItem).length_mm),
          tap: normalizeTap(i as { tap?: boolean; screw?: boolean }),
          qty_on_hand: Number((i as { qty_on_hand?: number }).qty_on_hand),
        }));
      console.log("GET inventory ok");
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: jsonBody({ items }),
      };
    } catch (err) {
      const e = err as { error?: { error?: { path?: { ".tag"?: string } } } };
      if (e?.error?.error?.path?.[".tag"] === "not_found") {
        console.log("GET inventory ok (empty)");
        return {
          statusCode: 200,
          headers: jsonHeaders,
          body: jsonBody({ items: [] }),
        };
      }
      console.error("inventory GET error:", err);
      console.error("inventory GET error detail:", {
        status: (err as any)?.status,
        error: (err as any)?.error,
        responseStatus: (err as any)?.response?.status,
        responseData: (err as any)?.response?.data,
        error_summary: (err as any)?.error_summary,
      });
      const message = (err as Error)?.message ?? "Failed to load inventory";
      const detail = extractDropboxErrorDetail(err);
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: "Dropbox API error", detail: `${message} | ${detail}` }),
      };
    }
  }

  if (event.httpMethod === "POST") {
    let items: InvItem[];
    try {
      const body = event.body ?? "{}";
      const parsed = JSON.parse(body) as { items?: unknown };
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
      items = rawItems
        .filter((i: unknown) => i != null && typeof i === "object")
        .map((i: Record<string, unknown>) => {
          const row = i as { length_mm?: number; tap?: boolean; screw?: boolean; qty_on_hand?: number };
          return {
            length_mm: Number(row.length_mm),
            tap: normalizeTap(row),
            qty_on_hand: Number(row.qty_on_hand),
          };
        });
    } catch (parseErr) {
      console.error("inventory POST: invalid JSON body", parseErr);
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: "Invalid JSON body" }),
      };
    }
    try {
      const toSave = items.map(({ length_mm, tap, qty_on_hand }) => ({
        length_mm,
        tap,
        qty_on_hand,
      }));
      await dbx.filesUpload({
        path: DROPBOX_PATH,
        contents: JSON.stringify({ items: toSave }, null, 2),
        mode: { ".tag": "overwrite" },
      });
      console.log("POST inventory ok");
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: jsonBody({ ok: true }),
      };
    } catch (err) {
      console.error("inventory POST error:", err);
      console.error("inventory POST error detail:", {
        status: (err as any)?.status,
        error: (err as any)?.error,
        responseStatus: (err as any)?.response?.status,
        responseData: (err as any)?.response?.data,
        error_summary: (err as any)?.error_summary,
      });
      const message = (err as Error)?.message ?? "Failed to save inventory";
      const detail = extractDropboxErrorDetail(err);
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: "Dropbox API error", detail: `${message} | ${detail}` }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: jsonHeaders,
    body: jsonBody({ ok: false, error: "Method not allowed" }),
  };
};
