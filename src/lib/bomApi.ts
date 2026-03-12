const BOM_API = "/.netlify/functions/bom";

export type ModelId = "cube" | "i_board" | "i_plate10" | "l";

export type BomItem = {
  model_id: ModelId;
  model: string;
  size: string;
  stage: number;
  length_mm: number;
  tap: boolean;
  qty_per_unit: number;
};

export const MODEL_IDS: ModelId[] = ["cube", "i_board", "i_plate10", "l"];

/** BOM サイズ候補（製作・BOM登録で使用） */
export const BOM_SIZES = ["200x200", "200x400", "400x400"] as const;
export type BomSize = (typeof BOM_SIZES)[number];

const SIZE_ORDER: Record<string, number> = {
  "200x200": 1,
  "200x400": 2,
  "400x400": 3,
};

const MODEL_ID_TO_LABEL: Record<ModelId, string> = {
  cube: "CUBE型",
  i_board: "I型（足場板）",
  i_plate10: "I型（薄板10㎜）",
  l: "L型",
};

const LABEL_TO_MODEL_ID: Record<string, ModelId> = {
  "CUBE型": "cube",
  "I型（足場板）": "i_board",
  "I型（薄板10㎜）": "i_plate10",
  "L型": "l",
};

/** 旧データ用: model 文字列から model_id を補完する */
export function normalizeModelId(model?: string): ModelId {
  if (model && model in LABEL_TO_MODEL_ID) {
    return LABEL_TO_MODEL_ID[model];
  }
  return "cube";
}

export function getModelLabel(model_id: ModelId): string {
  return MODEL_ID_TO_LABEL[model_id];
}

const MODEL_ORDER: Record<ModelId, number> = {
  cube: 1,
  i_board: 2,
  i_plate10: 3,
  l: 4,
};

export function sortBomItems(items: BomItem[]): BomItem[] {
  return [...items].sort(
    (a, b) =>
      MODEL_ORDER[a.model_id] - MODEL_ORDER[b.model_id] ||
      (SIZE_ORDER[a.size] ?? 99) - (SIZE_ORDER[b.size] ?? 99) ||
      a.stage - b.stage ||
      a.length_mm - b.length_mm ||
      Number(a.tap) - Number(b.tap)
  );
}

export function hasBomForSelection(
  bom: BomItem[],
  model_id: ModelId,
  size: string,
  stage: number
): boolean {
  return bom.some(
    (b) => b.model_id === model_id && b.size === size && b.stage === stage
  );
}

/** 既存データ互換: tap が無ければ screw を tap として読む */
function normalizeTapFromRaw(raw: { tap?: boolean; screw?: boolean }): boolean {
  if (typeof raw.tap === "boolean") return raw.tap;
  if (typeof raw.screw === "boolean") return raw.screw;
  return false;
}

function normalizeItem(raw: {
  model_id?: string;
  model?: string;
  size?: string;
  stage?: number;
  length_mm?: number;
  tap?: boolean;
  screw?: boolean;
  qty_per_unit?: number;
}): BomItem {
  const model_id =
    raw.model_id && MODEL_IDS.includes(raw.model_id as ModelId)
      ? (raw.model_id as ModelId)
      : normalizeModelId(raw.model);
  const model = MODEL_ID_TO_LABEL[model_id] ?? raw.model ?? "CUBE型";
  const size =
    raw.size && BOM_SIZES.includes(raw.size as BomSize) ? raw.size : "200x200";
  return {
    model_id,
    model,
    size,
    stage: Number(raw.stage) || 1,
    length_mm: Number(raw.length_mm) || 205,
    tap: normalizeTapFromRaw(raw),
    qty_per_unit: Number(raw.qty_per_unit) || 0,
  };
}

export async function fetchBom(): Promise<BomItem[]> {
  const res = await fetch(BOM_API, { method: "GET" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ?? `BOMの読み込みに失敗しました (${res.status})`
    );
  }
  const data = (await res.json()) as { items?: unknown[] };
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((it) => normalizeItem(it as Record<string, unknown>));
}

export async function saveBom(items: BomItem[]): Promise<void> {
  const res = await fetch(BOM_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ?? `BOMの保存に失敗しました (${res.status})`
    );
  }
}
