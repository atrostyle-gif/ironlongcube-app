import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";
import { getDropboxAccessToken } from "./lib/dropboxAuth";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const BOM_PATH = "/ironlongcube/bom.json";
const INVENTORY_PATH = "/inventory.json";
const CUT_ISSUES_PATH = "/ironlongcube/cut-issues.json";

type ProductionItem = {
  model_id: string;
  size: string;
  stage: number;
  qty: number;
};

type BomItem = {
  model_id?: string;
  model?: string;
  size?: string;
  stage: number;
  length_mm: number;
  tap?: boolean;
  screw?: boolean;
  qty_per_unit: number;
};

type InvItem = {
  length_mm: number;
  tap: boolean;
  qty_on_hand: number;
};

type PartQty = { length_mm: number; tap: boolean; qty: number };

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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function downloadJson<T>(
  dbx: Dropbox,
  filePath: string,
  defaultVal: T
): Promise<T> {
  try {
    const res = await dbx.filesDownload({ path: filePath });
    const result = res.result as { fileBinary?: Buffer; fileBlob?: Blob };
    const raw = await getDownloadedFileAsText(result);
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    const e = err as { error?: { error?: { path?: { ".tag"?: string } } } };
    if (e?.error?.error?.path?.[".tag"] === "not_found") {
      return defaultVal;
    }
    throw err;
  }
}

function computeParts(
  bomItems: { items?: BomItem[] },
  productions: ProductionItem[]
): PartQty[] {
  const items = Array.isArray(bomItems?.items) ? bomItems.items : [];
  const map = new Map<string, PartQty>();
  for (const prod of productions) {
    for (const b of items) {
      const mid = b.model_id ?? "";
      const sz = b.size ?? "";
      if (mid !== prod.model_id || sz !== prod.size || b.stage !== prod.stage) {
        continue;
      }
      const q = (b.qty_per_unit ?? 0) * prod.qty;
      if (q <= 0) continue;
      const tap = normalizeTap(b);
      const key = `${b.length_mm}|${tap ? 1 : 0}`;
      const prev = map.get(key);
      if (prev) prev.qty += q;
      else map.set(key, { length_mm: b.length_mm, tap, qty: q });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.length_mm - b.length_mm || Number(a.tap) - Number(b.tap)
  );
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: jsonHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Method not allowed" }),
    };
  }

  let token: string;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    const msg = (err as Error)?.message ?? "Failed to get Dropbox access token";
    console.error("issue-cut: getDropboxAccessToken failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Dropbox token error", detail: msg }),
    };
  }

  const dbx = new Dropbox({ accessToken: token });

  let productions: ProductionItem[];
  try {
    const body = event.body ?? "{}";
    const parsed = JSON.parse(body) as { productions?: unknown };
    if (!Array.isArray(parsed?.productions)) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: jsonBody({ ok: false, error: "productions array required" }),
      };
    }
    productions = parsed.productions as ProductionItem[];
  } catch {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Invalid JSON body" }),
    };
  }

  let bomData: { items?: BomItem[] };
  try {
    bomData = await downloadJson(dbx, BOM_PATH, { items: [] });
  } catch (err) {
    console.error("issue-cut: failed to load bom", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Failed to load BOM" }),
    };
  }

  const parts = computeParts(bomData, productions);
  if (parts.length === 0) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "No parts for given productions" }),
    };
  }

  let invData: { items?: InvItem[] };
  try {
    invData = await downloadJson(dbx, INVENTORY_PATH, { items: [] });
  } catch (err) {
    console.error("issue-cut: failed to load inventory", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Failed to load inventory" }),
    };
  }

  const invList = Array.isArray(invData?.items) ? invData.items : [];
  const invMap = new Map<string, number>();
  for (const it of invList) {
    const tap = "tap" in it && typeof it.tap === "boolean" ? it.tap : normalizeTap(it as { screw?: boolean });
    invMap.set(`${it.length_mm}|${tap ? 1 : 0}`, it.qty_on_hand);
  }

  // 在庫はある分だけ消費。不足分があっても確定可。在庫はマイナスにしない。
  for (const p of parts) {
    const key = `${p.length_mm}|${p.tap ? 1 : 0}`;
    const current = invMap.get(key) ?? 0;
    const newQty = Math.max(0, current - p.qty);
    invMap.set(key, newQty);
  }

  const newInvList: InvItem[] = [];
  for (const [key, qty] of invMap) {
    if (qty <= 0) continue;
    const [length_mm, tapFlag] = key.split("|").map(Number);
    newInvList.push({
      length_mm,
      tap: tapFlag === 1,
      qty_on_hand: qty,
    });
  }
  newInvList.sort(
    (a, b) => a.length_mm - b.length_mm || Number(a.tap) - Number(b.tap)
  );

  try {
    await dbx.filesUpload({
      path: INVENTORY_PATH,
      contents: JSON.stringify({ items: newInvList }, null, 2),
      mode: { ".tag": "overwrite" },
    });
  } catch (err) {
    console.error("issue-cut: failed to save inventory", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Failed to save inventory" }),
    };
  }

  type CutIssueRecord = {
    issue_id: string;
    created_at: string;
    productions: ProductionItem[];
    parts: PartQty[];
    inventory_applied: boolean;
  };

  let cutIssues: CutIssueRecord[] = [];
  try {
    cutIssues = await downloadJson(dbx, CUT_ISSUES_PATH, []);
    if (!Array.isArray(cutIssues)) cutIssues = [];
  } catch (err) {
    console.error("issue-cut: failed to load cut-issues", err);
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  const issue_id = `cut_${y}${m}${d}_${h}${min}${sec}`;

  const newIssue: CutIssueRecord = {
    issue_id,
    created_at: now.toISOString(),
    productions,
    parts: [...parts],
    inventory_applied: true,
  };
  cutIssues.push(newIssue);

  try {
    await dbx.filesUpload({
      path: CUT_ISSUES_PATH,
      contents: JSON.stringify(cutIssues, null, 2),
      mode: { ".tag": "overwrite" },
    });
  } catch (err) {
    console.error("issue-cut: failed to save cut-issues", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ ok: false, error: "Failed to save cut-issues" }),
    };
  }

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: jsonBody({ issue_id, parts }),
  };
};
