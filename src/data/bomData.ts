export type BomItem = {
  model: string;
  size: string;
  stage: number;
  length_mm: number;
  screw: boolean;
  qty_per_unit: number;
};

/**
 * BOM 固定データ（製作タブの必要数計算に使用）
 * 必要に応じて行を追加・編集してください。
 */
export const bomData: BomItem[] = [
  { model: "CUBE", size: "200x200", stage: 1, length_mm: 205, screw: false, qty_per_unit: 4 },
  { model: "CUBE", size: "200x200", stage: 1, length_mm: 205, screw: true, qty_per_unit: 4 },
  { model: "CUBE", size: "200x200", stage: 1, length_mm: 410, screw: false, qty_per_unit: 4 },
  { model: "CUBE", size: "200x200", stage: 2, length_mm: 205, screw: false, qty_per_unit: 8 },
  { model: "CUBE", size: "200x200", stage: 2, length_mm: 205, screw: true, qty_per_unit: 8 },
  { model: "CUBE", size: "200x200", stage: 2, length_mm: 410, screw: false, qty_per_unit: 8 },
];
