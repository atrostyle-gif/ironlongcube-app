import { getModelLabel, type BomItem, type ModelId } from "../lib/bomApi";

/** テンプレートで扱うモデル（CUBE型 / I型足場板 / I型薄板10mm のみ） */
export type TemplateModelId = "cube" | "i_board" | "i_plate10";

export type TemplateSize = "200x200" | "200x400" | "400x400";

export const TEMPLATE_MODEL_IDS: TemplateModelId[] = [
  "cube",
  "i_board",
  "i_plate10",
];

export const TEMPLATE_SIZES: TemplateSize[] = [
  "200x200",
  "200x400",
  "400x400",
];

type TemplateRow = { length_mm: number; tap: boolean; qty_per_unit: number };

type TemplateStageMap = Partial<Record<number, TemplateRow[]>>;
type TemplateSizeMap = Partial<Record<TemplateSize, TemplateStageMap>>;

/** model_id -> size -> stage -> TemplateRow[] */
const bomTemplates: Record<TemplateModelId, TemplateSizeMap> = {
  cube: {
    "200x200": {
      1: [
        { length_mm: 205, tap: false, qty_per_unit: 6 },
        { length_mm: 205, tap: true, qty_per_unit: 2 },
        { length_mm: 436, tap: false, qty_per_unit: 4 },
      ],
      2: [
        { length_mm: 205, tap: false, qty_per_unit: 10 },
        { length_mm: 205, tap: true, qty_per_unit: 2 },
        { length_mm: 859, tap: false, qty_per_unit: 4 },
      ],
      3: [
        { length_mm: 205, tap: false, qty_per_unit: 14 },
        { length_mm: 205, tap: true, qty_per_unit: 2 },
        { length_mm: 1282, tap: false, qty_per_unit: 4 },
      ],
      4: [
        { length_mm: 205, tap: false, qty_per_unit: 18 },
        { length_mm: 205, tap: true, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [
        { length_mm: 205, tap: false, qty_per_unit: 22 },
        { length_mm: 205, tap: true, qty_per_unit: 2 },
        { length_mm: 2128, tap: false, qty_per_unit: 4 },
      ],
    },
    "200x400": {
      1: [
        { length_mm: 205, tap: false, qty_per_unit: 4 },
        { length_mm: 410, tap: false, qty_per_unit: 2 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 436, tap: false, qty_per_unit: 4 },
      ],
      2: [
        { length_mm: 205, tap: false, qty_per_unit: 6 },
        { length_mm: 410, tap: false, qty_per_unit: 4 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 859, tap: false, qty_per_unit: 4 },
      ],
      3: [
        { length_mm: 205, tap: false, qty_per_unit: 8 },
        { length_mm: 410, tap: false, qty_per_unit: 6 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 1282, tap: false, qty_per_unit: 4 },
      ],
      4: [
        { length_mm: 205, tap: false, qty_per_unit: 10 },
        { length_mm: 410, tap: false, qty_per_unit: 8 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [
        { length_mm: 205, tap: false, qty_per_unit: 12 },
        { length_mm: 410, tap: false, qty_per_unit: 10 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 2128, tap: false, qty_per_unit: 4 },
      ],
    },
    "400x400": {
      1: [
        { length_mm: 410, tap: false, qty_per_unit: 6 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 436, tap: false, qty_per_unit: 4 },
      ],
      2: [
        { length_mm: 410, tap: false, qty_per_unit: 10 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 859, tap: false, qty_per_unit: 4 },
      ],
      3: [
        { length_mm: 410, tap: false, qty_per_unit: 14 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 1282, tap: false, qty_per_unit: 4 },
      ],
      4: [
        { length_mm: 410, tap: false, qty_per_unit: 18 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [
        { length_mm: 410, tap: false, qty_per_unit: 22 },
        { length_mm: 410, tap: true, qty_per_unit: 2 },
        { length_mm: 2128, tap: false, qty_per_unit: 4 },
      ],
    },
  },
  i_board: {
    "200x200": {
      4: [
        { length_mm: 205, tap: false, qty_per_unit: 16 },
        { length_mm: 231, tap: false, qty_per_unit: 2 },
        { length_mm: 231, tap: true, qty_per_unit: 2 },
        { length_mm: 1679, tap: false, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [
        { length_mm: 205, tap: false, qty_per_unit: 20 },
        { length_mm: 231, tap: false, qty_per_unit: 2 },
        { length_mm: 231, tap: true, qty_per_unit: 2 },
        { length_mm: 2102, tap: false, qty_per_unit: 2 },
        { length_mm: 2128, tap: false, qty_per_unit: 4 },
      ],
    },
    "200x400": {
      4: [
        { length_mm: 205, tap: false, qty_per_unit: 8 },
        { length_mm: 410, tap: false, qty_per_unit: 8 },
        { length_mm: 436, tap: false, qty_per_unit: 2 },
        { length_mm: 436, tap: true, qty_per_unit: 2 },
        { length_mm: 1679, tap: false, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [
        { length_mm: 205, tap: false, qty_per_unit: 12 },
        { length_mm: 410, tap: false, qty_per_unit: 8 },
        { length_mm: 436, tap: false, qty_per_unit: 2 },
        { length_mm: 436, tap: true, qty_per_unit: 2 },
        { length_mm: 2102, tap: false, qty_per_unit: 2 },
        { length_mm: 2128, tap: false, qty_per_unit: 4 },
      ],
    },
  },
  i_plate10: {
    "200x200": {
      4: [
        { length_mm: 205, tap: false, qty_per_unit: 16 },
        { length_mm: 256, tap: false, qty_per_unit: 2 },
        { length_mm: 256, tap: true, qty_per_unit: 2 },
        { length_mm: 1679, tap: false, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [{ length_mm: 205, tap: false, qty_per_unit: 16 }],
    },
    "200x400": {
      4: [
        { length_mm: 205, tap: false, qty_per_unit: 10 },
        { length_mm: 410, tap: false, qty_per_unit: 6 },
        { length_mm: 431, tap: false, qty_per_unit: 2 },
        { length_mm: 431, tap: true, qty_per_unit: 2 },
        { length_mm: 1679, tap: false, qty_per_unit: 2 },
        { length_mm: 1705, tap: false, qty_per_unit: 4 },
      ],
      5: [
        { length_mm: 205, tap: false, qty_per_unit: 14 },
        { length_mm: 410, tap: false, qty_per_unit: 8 },
        { length_mm: 431, tap: false, qty_per_unit: 2 },
        { length_mm: 431, tap: true, qty_per_unit: 2 },
        { length_mm: 2102, tap: false, qty_per_unit: 2 },
        { length_mm: 2128, tap: false, qty_per_unit: 4 },
      ],
    },
  },
};

/**
 * 指定条件のテンプレート行を BomItem[] で返す。
 * 未定義または qty_per_unit <= 0 の行は含めない。
 * 未定義の場合は null。
 */
export function getTemplateItems(
  model_id: TemplateModelId,
  size: TemplateSize,
  stage: number
): BomItem[] | null {
  const sizeMap = bomTemplates[model_id];
  if (!sizeMap) return null;

  const stageMap = sizeMap[size];
  if (!stageMap || typeof stageMap !== "object") return null;

  const rows = stageMap[stage];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const model = getModelLabel(model_id as ModelId);
  const items: BomItem[] = [];
  for (const r of rows) {
    if (r.qty_per_unit > 0) {
      items.push({
        model_id: model_id as ModelId,
        model,
        size,
        stage,
        length_mm: r.length_mm,
        tap: r.tap,
        qty_per_unit: r.qty_per_unit,
        confirmed: false,
      });
    }
  }
  return items.length > 0 ? items : null;
}
