import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";

// ローカル (netlify dev): .env から DROPBOX_ACCESS_TOKEN を読む
// 本番: Netlify の環境変数が process.env に注入されるため、dotenv が無くても token は取得できる
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Dropbox App Folder ルートの inventory.json（App タイプが App folder であること）
const DROPBOX_PATH = "/inventory.json";

type InvItem = {
  length_mm: number;
  screw: boolean;
  qty_on_hand: number;
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

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  console.log("cwd:", process.cwd());
  console.log("env path:", path.resolve(process.cwd(), ".env"));
  console.log("DROPBOX token loaded:", Boolean(token));

  // 本番で 500 の場合は Netlify の DROPBOX_ACCESS_TOKEN と Dropbox App Folder 設定を確認
  if (!token) {
    console.error("inventory: DROPBOX_ACCESS_TOKEN not set");
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({
        ok: false,
        error: "DROPBOX_ACCESS_TOKEN not set",
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

      const items = Array.isArray(parsed?.items) ? parsed.items : [];
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
      const message = (err as Error)?.message ?? "Failed to load inventory";
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: message }),
      };
    }
  }

  if (event.httpMethod === "POST") {
    let items: InvItem[];
    try {
      const body = event.body ?? "{}";
      const parsed = JSON.parse(body) as { items?: unknown };
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
      items = rawItems.filter(
        (i): i is InvItem => i != null && typeof i === "object"
      ) as InvItem[];
    } catch (parseErr) {
      console.error("inventory POST: invalid JSON body", parseErr);
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
      console.log("POST inventory ok");
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: jsonBody({ ok: true }),
      };
    } catch (err) {
      console.error("inventory POST error:", err);
      const message = (err as Error)?.message ?? "Failed to save inventory";
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: jsonHeaders,
    body: jsonBody({ ok: false, error: "Method not allowed" }),
  };
};
