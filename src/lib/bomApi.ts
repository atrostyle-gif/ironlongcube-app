const BOM_API = "/.netlify/functions/bom";

export type ModelId = "cube" | "i_board" | "i_plate10" | "l";

export type BomItem = {
  model_id: ModelId;
  model: string;
  stage: number;
  length_mm: number;
  screw: boolean;
  qty_per_unit: number;
};

export const MODEL_IDS: ModelId[] = ["cube", "i_board", "i_plate10", "l"];

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
      a.stage - b.stage ||
      a.length_mm - b.length_mm ||
      Number(a.screw) - Number(b.screw)
  );
}

export function hasBomForSelection(
  bom: BomItem[],
  model_id: ModelId,
  stage: number
): boolean {
  return bom.some((b) => b.model_id === model_id && b.stage === stage);
}

function normalizeItem(raw: {
  model_id?: string;
  model?: string;
  stage?: number;
  length_mm?: number;
  screw?: boolean;
  qty_per_unit?: number;
}): BomItem {
  const model_id =
    raw.model_id && MODEL_IDS.includes(raw.model_id as ModelId)
      ? (raw.model_id as ModelId)
      : normalizeModelId(raw.model);
  const model = MODEL_ID_TO_LABEL[model_id] ?? raw.model ?? "CUBE型";
  return {
    model_id,
    model,
    stage: Number(raw.stage) || 1,
    length_mm: Number(raw.length_mm) || 205,
    screw: Boolean(raw.screw),
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
