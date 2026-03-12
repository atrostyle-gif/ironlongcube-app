import type { BomItem } from "./bomApi";
import type { ProductionItem } from "../types/cutIssue";

export type ExpandedPartRequirement = {
  productionLabel: string;
  model_id: string;
  size: string;
  stage: number;
  qty_units: number;
  length_mm: number;
  tap: boolean;
  qty: number;
};

export type PartWithBreakdown = {
  length_mm: number;
  tap: boolean;
  qty: number;
  breakdown: { label: string; qty: number }[];
};

export type NeedRowFromList = {
  length_mm: number;
  tap: boolean;
  required: number;
  on_hand: number;
  shortage: number;
  diff: number;
};

function partKey(length_mm: number, tap: boolean): string {
  return `${length_mm}|${tap ? 1 : 0}`;
}

export function expandProductionList(
  productionList: ProductionItem[],
  bom: BomItem[],
  getModelLabel: (model_id: string) => string
): ExpandedPartRequirement[] {
  const out: ExpandedPartRequirement[] = [];
  for (const prod of productionList) {
    const label = `${getModelLabel(prod.model_id)} ${prod.size} ${prod.stage}段 ×${prod.qty}台`;
    const lines = bom.filter(
      (b) =>
        b.model_id === prod.model_id &&
        b.size === prod.size &&
        b.stage === prod.stage
    );
    for (const b of lines) {
      const qty = b.qty_per_unit * prod.qty;
      if (qty <= 0) continue;
      out.push({
        productionLabel: label,
        model_id: prod.model_id,
        size: prod.size,
        stage: prod.stage,
        qty_units: prod.qty,
        length_mm: b.length_mm,
        tap: b.tap,
        qty,
      });
    }
  }
  return out;
}

export function aggregateToNeedRows(
  expandedList: ExpandedPartRequirement[],
  invMap: Map<string, number>,
  showShortageOnly: boolean
): NeedRowFromList[] {
  const reqMap = new Map<
    string,
    { length_mm: number; tap: boolean; required: number }
  >();
  for (const e of expandedList) {
    const key = partKey(e.length_mm, e.tap);
    const prev = reqMap.get(key);
    if (prev) prev.required += e.qty;
    else reqMap.set(key, { length_mm: e.length_mm, tap: e.tap, required: e.qty });
  }
  const out: NeedRowFromList[] = [];
  for (const v of reqMap.values()) {
    const onHand = invMap.get(partKey(v.length_mm, v.tap)) ?? 0;
    const shortage = Math.max(v.required - onHand, 0);
    const diff = onHand - v.required;
    if (showShortageOnly && shortage <= 0) continue;
    out.push({
      length_mm: v.length_mm,
      tap: v.tap,
      required: v.required,
      on_hand: onHand,
      shortage,
      diff,
    });
  }
  out.sort(
    (a, b) =>
      b.shortage - a.shortage ||
      a.length_mm - b.length_mm ||
      Number(a.tap) - Number(b.tap)
  );
  return out;
}

export function getPartWithBreakdown(
  expandedList: ExpandedPartRequirement[]
): PartWithBreakdown[] {
  const byKey = new Map<
    string,
    { length_mm: number; tap: boolean; qty: number; breakdown: Map<string, number> }
  >();
  for (const e of expandedList) {
    const key = partKey(e.length_mm, e.tap);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        length_mm: e.length_mm,
        tap: e.tap,
        qty: 0,
        breakdown: new Map(),
      };
      byKey.set(key, entry);
    }
    entry.qty += e.qty;
    const prev = entry.breakdown.get(e.productionLabel) ?? 0;
    entry.breakdown.set(e.productionLabel, prev + e.qty);
  }
  return Array.from(byKey.values())
    .map((e) => ({
      length_mm: e.length_mm,
      tap: e.tap,
      qty: e.qty,
      breakdown: Array.from(e.breakdown.entries()).map(([label, qty]) => ({
        label,
        qty,
      })),
    }))
    .sort(
      (a, b) =>
        a.length_mm - b.length_mm || Number(a.tap) - Number(b.tap)
    );
}
