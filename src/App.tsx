import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  fetchBom,
  saveBom,
  getModelLabel,
  BOM_SIZES,
  MODEL_IDS,
  sortBomItems,
  type BomItem,
  type BomSize,
  type ModelId,
} from "./lib/bomApi";
import {
  fetchInventory,
  saveInventory,
  type InvItem,
} from "./lib/inventoryApi";
import {
  getTemplateItems,
  TEMPLATE_MODEL_IDS,
  TEMPLATE_SIZES,
  type TemplateModelId,
  type TemplateSize,
} from "./data/bomTemplates";
import { postIssueCut, type IssueCutPart } from "./lib/issueCutApi";
import type { ProductionItem } from "./types/cutIssue";
import {
  expandProductionList,
  aggregateToNeedRows,
  getPartWithBreakdown,
  type NeedRowFromList,
} from "./lib/productionList";
import {
  fetchDrawings,
  uploadDrawing,
  getDrawingFileUrl,
  type Drawing,
} from "./lib/drawingApi";

const STAGE_OPTIONS = [1, 2, 3, 4, 5];

function buildProductionSummaryLines(
  list: ProductionItem[],
  getModelLabel: (id: string) => string
): string[] {
  return list.map(
    (p) =>
      `${getModelLabel(p.model_id as ModelId)} / ${p.size} / ${p.stage}段 / ${p.qty}台`
  );
}

function formatLengthLabel(length_mm: number, tap: boolean): string {
  return tap ? `${length_mm}mm (TAP)` : `${length_mm}mm`;
}

function formatTotalLengthMeters(totalMm: number): string {
  return `${(totalMm / 1000).toFixed(2)}m`;
}

/** 印刷用：切断数ベースの1行 */
type CutSheetRow = {
  length_mm: number;
  tap: boolean;
  required: number;
  on_hand: number;
  cut_qty: number;
  next_process: string;
  total_cut_length_mm: number;
  breakdown: { label: string; qty: number }[];
};

function buildBreakdownText(breakdown: { label: string; qty: number }[]): string {
  return breakdown.map((x) => `${x.label}:${x.qty}本`).join(" / ");
}

export default function App() {
  // Inventory: inv = 一覧, 初回は fetchInventory(), 追加/更新で saveInventory() 後に setInv
  const [inv, setInv] = useState<InvItem[]>([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invLoadError, setInvLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [savingInProgress, setSavingInProgress] = useState(false);

  const [tab, setTab] = useState<"make" | "inv" | "bom">("make");

  const [bom, setBom] = useState<BomItem[]>([]);
  const [bomLoading, setBomLoading] = useState(true);
  const [bomLoadError, setBomLoadError] = useState<string | null>(null);
  const [bomSaveError, setBomSaveError] = useState<string | null>(null);
  const [bomSaveSuccess, setBomSaveSuccess] = useState<string | null>(null);
  const [bomSavingInProgress, setBomSavingInProgress] = useState(false);

  const [modelId, setModelId] = useState<ModelId>("cube");
  const [size, setSize] = useState<BomSize>("200x200");
  const [stage, setStage] = useState(1);
  const [units, setUnits] = useState(1);

  const [showShortageOnly, setShowShortageOnly] = useState(false);

  const [productionList, setProductionList] = useState<ProductionItem[]>([]);

  const [lastIssueId, setLastIssueId] = useState<string | null>(null);
  const [lastIssueParts, setLastIssueParts] = useState<IssueCutPart[] | null>(
    null
  );
  const [issueCutLoading, setIssueCutLoading] = useState(false);
  const [issueCutError, setIssueCutError] = useState<string | null>(null);

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUploadError, setDrawingUploadError] = useState<string | null>(null);
  const [uploadDrawingModelId, setUploadDrawingModelId] = useState<ModelId>("cube");
  const [uploadDrawingSize, setUploadDrawingSize] = useState<BomSize>("200x200");
  const [uploadDrawingStage, setUploadDrawingStage] = useState(1);
  const drawingFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInvLoadError(null);
    setInvLoading(true);
    fetchInventory()
      .then((items) => {
        setInv(items);
        setInvLoadError(null);
      })
      .catch((err) => {
        console.error("fetchInventory failed:", err);
        setInvLoadError(err?.message ?? "在庫の読み込みに失敗しました");
      })
      .finally(() => setInvLoading(false));
  }, []);

  useEffect(() => {
    setBomLoadError(null);
    setBomLoading(true);
    fetchBom()
      .then((items) => {
        setBom(items);
        setBomLoadError(null);
      })
      .catch((err) => {
        console.error("fetchBom failed:", err);
        setBomLoadError(err?.message ?? "BOMの読み込みに失敗しました");
      })
      .finally(() => setBomLoading(false));
  }, []);

  function loadDrawings() {
    fetchDrawings()
      .then(setDrawings)
      .catch(() => setDrawings([]));
  }
  useEffect(() => {
    if (tab === "make") loadDrawings();
  }, [tab]);

  // -------------------------
  // 製作タブ: 候補生成（BOM から動的に）
  // -------------------------

  const availableModels = useMemo(
    () =>
      Array.from(
        bom.reduce((map, b) => {
          if (!map.has(b.model_id)) {
            map.set(b.model_id, b.model);
          }
          return map;
        }, new Map<ModelId, string>())
      )
        .map(([id, label]) => ({ id, label }))
        .sort(
          (a, b) =>
            MODEL_IDS.indexOf(a.id) - MODEL_IDS.indexOf(b.id)
        ),
    [bom]
  );

  const availableSizes = useMemo(() => {
    const set = new Set<string>();
    for (const b of bom) {
      if (b.model_id === modelId) {
        set.add(b.size);
      }
    }
    return BOM_SIZES.filter((s) => set.has(s));
  }, [bom, modelId]);

  const availableStages = useMemo(() => {
    const set = new Set<number>();
    for (const b of bom) {
      if (b.model_id === modelId && b.size === size) {
        set.add(b.stage);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [bom, modelId, size]);

  const availableSizesForUpload = useMemo(() => {
    const set = new Set<string>();
    for (const b of bom) {
      if (b.model_id === uploadDrawingModelId && b.size) {
        set.add(b.size);
      }
    }
    return BOM_SIZES.filter((s) => set.has(s));
  }, [bom, uploadDrawingModelId]);

  const availableStagesForUpload = useMemo(() => {
    const set = new Set<number>();
    for (const b of bom) {
      if (
        b.model_id === uploadDrawingModelId &&
        b.size === uploadDrawingSize
      ) {
        set.add(b.stage);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [bom, uploadDrawingModelId, uploadDrawingSize]);

  // 選択値の自動補正
  useEffect(() => {
    if (bom.length === 0 || availableModels.length === 0) return;
    if (!availableModels.some((m) => m.id === modelId)) {
      setModelId(availableModels[0].id);
    }
  }, [bom, availableModels, modelId]);

  useEffect(() => {
    if (bom.length === 0 || availableSizes.length === 0) return;
    if (!availableSizes.includes(size)) {
      setSize(availableSizes[0]);
    }
  }, [bom, availableSizes, size]);

  useEffect(() => {
    if (bom.length === 0 || availableStages.length === 0) return;
    if (!availableStages.includes(stage)) {
      setStage(availableStages[0]);
    }
  }, [bom, availableStages, stage]);

  // -------------------------
  // Inventory Map
  // -------------------------
  const invMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of inv) {
      m.set(`${it.length_mm}|${it.tap ? 1 : 0}`, it.qty_on_hand);
    }
    return m;
  }, [inv]);

  // -------------------------
  // 製作予定リスト → 展開・合算
  // -------------------------
  const expandedList = useMemo(
    () =>
      expandProductionList(productionList, bom, (id) =>
        getModelLabel(id as ModelId)
      ),
    [productionList, bom]
  );

  const needRows: NeedRowFromList[] = useMemo(
    () => aggregateToNeedRows(expandedList, invMap, showShortageOnly),
    [expandedList, invMap, showShortageOnly]
  );

  const partWithBreakdown = useMemo(
    () => getPartWithBreakdown(expandedList),
    [expandedList]
  );

  /** 印刷用：切断数ベース。cut_qty = max(0, required - on_hand), 総長 = length_mm * cut_qty */
  const cutSheetRows = useMemo((): CutSheetRow[] => {
    return partWithBreakdown.map((p) => {
      const on_hand = invMap.get(`${p.length_mm}|${p.tap ? 1 : 0}`) ?? 0;
      const required = p.qty;
      const cut_qty = Math.max(0, required - on_hand);
      return {
        length_mm: p.length_mm,
        tap: p.tap,
        required,
        on_hand,
        cut_qty,
        next_process: p.tap ? "MC (TAP加工)" : "溶接",
        total_cut_length_mm: p.length_mm * cut_qty,
        breakdown: p.breakdown,
      };
    });
  }, [partWithBreakdown, invMap]);

  /** 印刷対象：切断数 > 0 の行のみ */
  const cutSheetRowsFiltered = useMemo(
    () => cutSheetRows.filter((r) => r.cut_qty > 0),
    [cutSheetRows]
  );

  const shortageKindCount = needRows.filter((r) => r.shortage > 0).length;
  const shortageTotalQty = needRows.reduce((s, r) => s + r.shortage, 0);

  function addToProductionList() {
    const hasBom = bom.some(
      (b) => b.model_id === modelId && b.size === size && b.stage === stage
    );
    if (!hasBom) return;
    const existing = productionList.findIndex(
      (p) => p.model_id === modelId && p.size === size && p.stage === stage
    );
    if (existing >= 0) {
      setProductionList((prev) =>
        prev.map((p, i) =>
          i === existing ? { ...p, qty: p.qty + units } : p
        )
      );
    } else {
      setProductionList((prev) => [
        ...prev,
        { model_id: modelId, size, stage, qty: units },
      ]);
    }
  }

  function removeFromProductionList(index: number) {
    setProductionList((prev) => prev.filter((_, i) => i !== index));
  }

  const drawingMap = useMemo(() => {
    const m = new Map<string, Drawing>();
    for (const d of drawings) {
      m.set(`${d.model_id}|${d.size}|${d.stage}`, d);
    }
    return m;
  }, [drawings]);

  const showBomWarning = bom.length === 0;

  async function updateInventory(
    length_mm: number,
    tap: boolean,
    qty_on_hand: number
  ) {
    setSaveError(null);
    setSaveSuccessMessage(null);
    setSavingInProgress(true);
    const key = `${length_mm}|${tap ? 1 : 0}`;
    const next = inv.filter(
      (it) => `${it.length_mm}|${it.tap ? 1 : 0}` !== key
    );
    next.push({ length_mm, tap, qty_on_hand });
    next.sort(
      (a, b) =>
        a.length_mm - b.length_mm || Number(a.tap) - Number(b.tap)
    );
    try {
      await saveInventory(next);
      setInv(next);
      setSaveSuccessMessage("保存しました");
      window.setTimeout(() => setSaveSuccessMessage(null), 2000);
    } catch (err) {
      console.error("saveInventory failed:", err);
      setSaveError((err as Error)?.message ?? "在庫の保存に失敗しました");
      setSaveSuccessMessage(null);
    } finally {
      setSavingInProgress(false);
    }
  }

  function bomRowKey(item: BomItem): string {
    return `${item.model_id}|${item.size}|${item.stage}|${item.length_mm}|${item.tap ? 1 : 0}`;
  }

  /** 選択中の BOM セットだけ置き換えて保存（他モデルは変更しない） */
  async function saveSelectedBom(
    selectedModelId: ModelId,
    selectedSize: string,
    selectedStage: number,
    editorRows: { length_mm: number; tap: boolean; qty: number }[],
    confirmed: boolean
  ) {
    setBomSaveError(null);
    setBomSaveSuccess(null);
    setBomSavingInProgress(true);
    const others = bom.filter(
      (b) =>
        !(
          b.model_id === selectedModelId &&
          b.size === selectedSize &&
          b.stage === selectedStage
        )
    );
    const updated = editorRows.map((r) => ({
      model_id: selectedModelId,
      model: getModelLabel(selectedModelId),
      size: selectedSize,
      stage: selectedStage,
      length_mm: r.length_mm,
      tap: r.tap,
      qty_per_unit: r.qty,
      confirmed,
    }));
    const nextBom = sortBomItems([...others, ...updated]);
    try {
      await saveBom(nextBom);
      setBom(nextBom);
      setBomSaveSuccess("保存しました");
      window.setTimeout(() => setBomSaveSuccess(null), 2000);
    } catch (err) {
      console.error("saveBom failed:", err);
      setBomSaveError((err as Error)?.message ?? "BOMの保存に失敗しました");
    } finally {
      setBomSavingInProgress(false);
    }
  }

  /** テンプレート適用: "applied" または "not_defined" */
  async function applyTemplate(
    templateModelId: TemplateModelId,
    size: TemplateSize,
    stage: number
  ): Promise<"applied" | "not_defined"> {
    const items = getTemplateItems(templateModelId, size, stage);
    if (!items || items.length === 0) return "not_defined";
    setBomSaveError(null);
    setBomSaveSuccess(null);
    setBomSavingInProgress(true);
    try {
      let next = [...bom];
      for (const item of items) {
        next = next.filter((b) => bomRowKey(b) !== bomRowKey(item));
        next.push(item);
      }
      const sorted = sortBomItems(next);
      await saveBom(sorted);
      setBom(sorted);
      setBomSaveSuccess("テンプレートを適用しました");
      window.setTimeout(() => setBomSaveSuccess(null), 2000);
      return "applied";
    } catch (err) {
      console.error("applyTemplate failed:", err);
      setBomSaveError((err as Error)?.message ?? "テンプレートの適用に失敗しました");
      return "not_defined";
    } finally {
      setBomSavingInProgress(false);
    }
  }

  async function copyCutList() {
    const lines = needRows
      .filter((r) => r.shortage > 0)
      .map((r) => `${formatLengthLabel(r.length_mm, r.tap)}\t${r.shortage}本`);

    const text = lines.length ? lines.join("\n") : "不足なし";
    await navigator.clipboard.writeText(text);
    alert("コピーしました");
  }

  function openCutSheetWithBreakdown(
    rows: CutSheetRow[],
    summaryLines: string[],
    dateStr: string
  ) {
    let totalCutMm = 0;
    const sections = rows
      .map((r) => {
        totalCutMm += r.total_cut_length_mm;
        const lengthLabel = formatLengthLabel(r.length_mm, r.tap);
        const totalStr = formatTotalLengthMeters(r.total_cut_length_mm);
        const breakdownText =
          r.breakdown.length > 0
            ? buildBreakdownText(r.breakdown)
            : "";
        const breakdownRow =
          breakdownText !== ""
            ? `<tr class="breakdown-row"><td colspan="6" class="breakdown-cell">${breakdownText}</td></tr>`
            : "";
        return `<tr class="part-header"><td>${lengthLabel}</td><td class="num">${r.required}</td><td class="num">${r.on_hand}</td><td class="num cut-qty-col">${r.cut_qty}</td><td>${r.next_process}</td><td class="total-length">${totalStr}</td></tr>${breakdownRow}`;
      })
      .join("");

    const productHtml =
      summaryLines.length > 0
        ? summaryLines.map((line) => `<div class="product-line">${line}</div>`).join("")
        : "<div class=\"product-line\">（製作予定なし）</div>";

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>切断指示書（長さ別まとめ）</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: sans-serif; margin: 0; padding: 15mm; font-size: 16px; }
  .toolbar { margin-bottom: 12px; }
  .toolbar button { padding: 8px 16px; font-size: 15px; cursor: pointer; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; font-size: 17px; flex-wrap: wrap; gap: 8px; }
  .product-block { font-weight: 600; font-size: 1.4rem; }
  .product-line { margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { border: 1px solid #333; padding: 8px 10px; text-align: left; }
  th { background: #eee; font-weight: 600; text-align: center; }
  .part-header { background: #fff; font-weight: 600; }
  .num { text-align: right; }
  th.cut-qty-col, td.cut-qty-col { font-weight: 700; background-color: #fef3c7; font-size: 1.1em; text-align: right; }
  .breakdown-row { background: #f5f5f5; }
  .breakdown-cell { font-size: 12px; color: #555; padding-left: 16px; padding-top: 2px; padding-bottom: 2px; }
  .total-length { text-align: right; white-space: nowrap; }
  @media print { .toolbar { display: none !important; }
    @page { size: A4 landscape; margin: 15mm; }
    body { font-family: sans-serif; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">印刷</button></div>
  <div class="header">
    <div class="product-block">
      <div>品名</div>
      ${productHtml}
    </div>
    <span>発注日：${dateStr}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>長さ</th><th>必要数</th><th>在庫数</th><th class="cut-qty-col">切断数</th><th>次工程</th><th>総長</th>
      </tr>
    </thead>
    <tbody>${sections.length ? sections : "<tr><td colspan=\"6\">切断必要なし</td></tr>"}</tbody>
    <tfoot>
      <tr><td colspan="5" style="text-align: right; font-weight: 600;">総長合計</td><td class="total-length" style="font-weight: 600;">${formatTotalLengthMeters(totalCutMm)}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("ポップアップがブロックされています。別ウィンドウで開くには許可してください。");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
  }

  function printCutSheet() {
    if (productionList.length === 0) {
      alert("製作予定を追加してください");
      return;
    }
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
    const summaryLines = buildProductionSummaryLines(productionList, (id) =>
      getModelLabel(id as ModelId)
    );
    openCutSheetWithBreakdown(cutSheetRowsFiltered, summaryLines, dateStr);
  }

  const KERF_MM = 3;
  function openCutSheetFromParts(
    parts: IssueCutPart[],
    productName: string,
    dateStr: string,
    unitsVal: number
  ) {
    let totalMm = 0;
    const rows = parts
      .map((p, i) => {
        const total =
          p.qty <= 0 ? 0 : p.length_mm * p.qty + KERF_MM * (p.qty - 1);
        totalMm += total;
        const sizeLabel = `■13x${p.length_mm}${p.tap ? " (TAP)" : ""}`;
        return `<tr>
          <td>${i + 1}</td>
          <td>SS黒皮</td>
          <td>${sizeLabel}</td>
          <td>0</td>
          <td>0</td>
          <td class="cut-qty">${p.qty}</td>
          <td>${p.tap ? "MC (TAP加工)" : "溶接"}</td>
          <td class="total-length">${total}</td>
        </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>切断指示書</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: sans-serif; margin: 0; padding: 15mm; font-size: 16px; }
  .toolbar { margin-bottom: 12px; }
  .toolbar button { padding: 8px 16px; font-size: 15px; cursor: pointer; }
  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; font-size: 17px; flex-wrap: wrap; gap: 8px; }
  .product { font-weight: 600; font-size: 1.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; table-layout: fixed; }
  th, td { border: 1px solid #333; padding: 8px 10px; text-align: left; }
  th:nth-child(1), td:nth-child(1) { width: 5%; }
  th:nth-child(2), td:nth-child(2) { width: 12%; }
  th:nth-child(3), td:nth-child(3) { width: 15%; }
  th:nth-child(4), td:nth-child(4) { width: 12%; }
  th:nth-child(5), td:nth-child(5) { width: 12%; }
  th:nth-child(6), td:nth-child(6) { width: 12%; }
  th:nth-child(7), td:nth-child(7) { width: 15%; }
  th:nth-child(8), td:nth-child(8) { width: 15%; }
  th { background: #eee; font-weight: 600; text-align: center; }
  tbody tr:nth-child(even) { background: #f0f0f0; }
  tbody tr:nth-child(odd) { background: #fff; }
  td:nth-child(1), td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7), td:nth-child(8) { text-align: right; }
  .total-length { white-space: nowrap; text-align: right; }
  @media print { .toolbar { display: none !important; }
    @page { size: A4 landscape; margin: 15mm; }
    body { font-family: sans-serif; }
    tbody tr:nth-child(even) { background: #f0f0f0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">印刷</button></div>
  <div class="header">
    <span class="product">品名：${productName}</span>
    <span>製作台数：${unitsVal}台</span>
    <span>発注日：${dateStr}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th><th>材種</th><th>サイズ</th><th>必要数</th><th>在庫数</th><th class="cut-qty">切断数</th><th>次工程</th><th class="total-length">総長(mm)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="7" style="text-align: right; font-weight: 600;">総長合計</td><td class="total-length" style="font-weight: 600;">${formatTotalLengthMeters(totalMm)}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("ポップアップがブロックされています。別ウィンドウで開くには許可してください。");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
  }

  async function confirmAndPrintCutSheet() {
    if (productionList.length === 0) return;
    setIssueCutError(null);
    setIssueCutLoading(true);
    const summaryLines = buildProductionSummaryLines(productionList, (id) =>
      getModelLabel(id as ModelId)
    );
    const cutSheetSnapshot = cutSheetRowsFiltered.map((r) => ({ ...r }));
    try {
      const res = await postIssueCut(productionList);
      setLastIssueId(res.issue_id);
      setLastIssueParts(res.parts);
      const today = new Date();
      const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
      openCutSheetWithBreakdown(cutSheetSnapshot, summaryLines, dateStr);
      await fetchInventory().then(setInv).catch(() => {});
      setProductionList([]);
    } catch (err) {
      setIssueCutError((err as Error)?.message ?? "切断指示の確定に失敗しました");
    } finally {
      setIssueCutLoading(false);
    }
  }

  function reprintCutSheet() {
    if (!lastIssueParts?.length) return;
    const productName = lastIssueId ? `再印刷 ${lastIssueId}` : "再印刷";
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
    const totalUnits = lastIssueParts.reduce((s, p) => s + p.qty, 0);
    openCutSheetFromParts(lastIssueParts, productName, dateStr, totalUnits);
  }

  return (
    <div style={appContainer}>
      <style>
        {`
          .field-large {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
          }
          .field-large:focus {
            outline: none;
            border-color: #2563eb;
            box-shadow: 0 0 0 1px #2563eb;
          }
          .data-row:hover {
            background-color: #f9fafb;
          }
        `}
      </style>

      <header style={headerRow}>
        <div style={headerTitle}>Ironlongcube</div>
      </header>

      {invLoadError && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          {invLoadError}（Netlify の DROPBOX_ACCESS_TOKEN を確認してください）
        </div>
      )}

      <div style={tabRow}>
        <button
          onClick={() => setTab("make")}
          style={{
            ...tabButton,
            ...(tab === "make" ? tabButtonActive : tabButtonInactive),
          }}
        >
          製作
        </button>
        <button
          onClick={() => setTab("inv")}
          style={{
            ...tabButton,
            ...(tab === "inv" ? tabButtonActive : tabButtonInactive),
          }}
        >
          在庫
        </button>
        <button
          onClick={() => setTab("bom")}
          style={{
            ...tabButton,
            ...(tab === "bom" ? tabButtonActive : tabButtonInactive),
          }}
        >
          BOM登録
        </button>
      </div>

      {tab === "make" ? (
        <>
          <div style={filterRow}>
            <label style={selectLabel}>
              モデル
              <select
                value={modelId}
                onChange={(e) =>
                  setModelId((e.target.value as ModelId) || "cube")
                }
                style={bigSelect}
                className="field-large"
                disabled={availableModels.length === 0}
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={selectLabel}>
              ラックサイズ
              <select
                value={size}
                onChange={(e) =>
                  setSize((e.target.value as BomSize) || "200x200")
                }
                style={bigSelect}
                className="field-large"
                disabled={availableSizes.length === 0}
              >
                {availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label style={selectLabel}>
              段数
              <select
                value={stage}
                onChange={(e) =>
                  setStage(parseInt(e.target.value, 10))
                }
                style={bigSelect}
                className="field-large"
                disabled={availableStages.length === 0}
              >
                {availableStages.map((s) => (
                  <option key={s} value={s}>
                    {s}段
                  </option>
                ))}
              </select>
            </label>

            <label style={selectLabel}>
              台数
              <input
                type="number"
                value={units}
                min={1}
                onChange={(e) =>
                  setUnits(parseInt(e.target.value || "1", 10))
                }
                style={bigInput}
                className="field-large"
              />
            </label>
            <button
              onClick={addToProductionList}
              disabled={
                availableModels.length === 0 ||
                !bom.some(
                  (b) =>
                    b.model_id === modelId &&
                    b.size === size &&
                    b.stage === stage
                )
              }
              style={primaryButton}
            >
              製作予定に追加
            </button>
          </div>

          {productionList.length > 0 && (
            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                製作予定リスト
              </h4>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={tableHeaderCell}>製作品</th>
                    <th style={tableHeaderCellRight}>台数</th>
                    <th style={tableHeaderCell}>図面</th>
                    <th style={tableHeaderCell}></th>
                  </tr>
                </thead>
                <tbody>
                  {productionList.map((p, i) => {
                    const drawing = drawingMap.get(`${p.model_id}|${p.size}|${p.stage}`);
                    return (
                      <tr key={`${p.model_id}-${p.size}-${p.stage}-${i}`} className="data-row">
                        <td style={tableCell}>
                          {getModelLabel(p.model_id as ModelId)} / {p.size} / {p.stage}段
                        </td>
                        <td style={tableCellRight}>{p.qty}台</td>
                        <td style={tableCell}>
                          {drawing ? (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(getDrawingFileUrl(drawing.drawing_path), "_blank")
                              }
                              style={{
                                ...secondaryButton,
                                padding: "4px 10px",
                                fontSize: 12,
                              }}
                            >
                              図面確認
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: "#888" }}>図面なし</span>
                          )}
                        </td>
                        <td style={tableCell}>
                          <button
                            type="button"
                            onClick={() => removeFromProductionList(i)}
                            style={{
                              ...secondaryButton,
                              padding: "4px 10px",
                              fontSize: 12,
                            }}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 20, marginBottom: 16, padding: 16, background: "#f8fafc", borderRadius: 8 }}>
            <h4 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>図面アップロード</h4>
            <div style={{ ...filterRow, flexWrap: "wrap" }}>
              <label style={selectLabel}>
                モデル
                <select
                  value={uploadDrawingModelId}
                  onChange={(e) =>
                    setUploadDrawingModelId((e.target.value as ModelId) || "cube")
                  }
                  style={bigSelect}
                  className="field-large"
                  disabled={availableModels.length === 0}
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={selectLabel}>
                サイズ
                <select
                  value={uploadDrawingSize}
                  onChange={(e) =>
                    setUploadDrawingSize((e.target.value as BomSize) || "200x200")
                  }
                  style={bigSelect}
                  className="field-large"
                  disabled={availableSizesForUpload.length === 0}
                >
                  {availableSizesForUpload.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={selectLabel}>
                段数
                <select
                  value={uploadDrawingStage}
                  onChange={(e) =>
                    setUploadDrawingStage(parseInt(e.target.value, 10) || 1)
                  }
                  style={bigSelect}
                  className="field-large"
                  disabled={availableStagesForUpload.length === 0}
                >
                  {availableStagesForUpload.map((s) => (
                    <option key={s} value={s}>
                      {s}段
                    </option>
                  ))}
                </select>
              </label>
              <label style={selectLabel}>
                ファイル（PDF / PNG / JPG）
                <input
                  ref={drawingFileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  style={{ fontSize: 14 }}
                />
              </label>
              <div style={{ alignSelf: "flex-end" }}>
                <button
                  type="button"
                  disabled={drawingUploading || availableModels.length === 0}
                  onClick={async () => {
                    const file = drawingFileInputRef.current?.files?.[0];
                    if (!file) {
                      setDrawingUploadError("ファイルを選択してください");
                      return;
                    }
                    setDrawingUploadError(null);
                    setDrawingUploading(true);
                    try {
                      await uploadDrawing(
                        uploadDrawingModelId,
                        uploadDrawingSize,
                        uploadDrawingStage,
                        file
                      );
                      loadDrawings();
                      drawingFileInputRef.current && (drawingFileInputRef.current.value = "");
                    } catch (err) {
                      setDrawingUploadError((err as Error)?.message ?? "アップロードに失敗しました");
                    } finally {
                      setDrawingUploading(false);
                    }
                  }}
                  style={primaryButton}
                >
                  {drawingUploading ? "アップロード中..." : "図面アップロード"}
                </button>
              </div>
            </div>
            {drawingUploadError && (
              <div style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>
                {drawingUploadError}
              </div>
            )}
          </div>

          <div style={toolbarRow}>
            <label style={{ display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showShortageOnly}
                onChange={(e) =>
                  setShowShortageOnly(e.target.checked)
                }
                style={{ marginRight: 6 }}
              />
              不足のみ表示
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={copyCutList}
                style={primaryButton}
              >
                切断指示コピー
              </button>
              <button
                onClick={printCutSheet}
                style={secondaryButton}
              >
                印刷用切断指示書
              </button>
              <button
                onClick={confirmAndPrintCutSheet}
                disabled={issueCutLoading || productionList.length === 0}
                style={primaryButton}
              >
                {issueCutLoading ? "処理中..." : "切断指示を確定して印刷"}
              </button>
              <button
                onClick={reprintCutSheet}
                disabled={!lastIssueParts?.length}
                style={secondaryButton}
              >
                切断指示を再印刷
              </button>
              {lastIssueId && (
                <span style={{ fontSize: 12, color: "#666", alignSelf: "center" }}>
                  確定済み: {lastIssueId}
                </span>
              )}
            </div>
          </div>

          {issueCutError && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                color: "#b91c1c",
                fontSize: 13,
              }}
            >
              {issueCutError}
            </div>
          )}

          {showBomWarning ? (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                borderRadius: 8,
                color: "#92400e",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              BOMが登録されていません
            </div>
          ) : (
            <>
              {productionList.length > 0 && (shortageKindCount > 0 || shortageTotalQty > 0) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    color: "#b91c1c",
                    fontSize: 13,
                  }}
                >
                  不足部材種類数: {shortageKindCount} / 不足合計本数: {shortageTotalQty}
                  <span style={{ display: "block", marginTop: 4 }}>
                    不足部材があります。在庫分を差し引いたうえで切断指示を確定します。
                  </span>
                </div>
              )}
              <table style={table}>
                <thead>
                  <tr>
                    <th style={tableHeaderCell}>長さ</th>
                    <th style={tableHeaderCellRight}>必要数</th>
                    <th style={tableHeaderCellRight}>在庫数</th>
                    <th style={tableHeaderCellRight}>差分</th>
                    <th style={tableHeaderCellRight}>不足数</th>
                  </tr>
                </thead>
                <tbody>
                  {needRows.map((r) => {
                    const hasSurplus =
                      r.shortage === 0 && r.on_hand >= r.required;
                    return (
                      <tr
                        key={`${r.length_mm}-${r.tap}`}
                        className="data-row"
                        style={
                          hasSurplus ? rowSurplus : undefined
                        }
                      >
                        <td style={tableCell}>{formatLengthLabel(r.length_mm, r.tap)}</td>
                        <td style={tableCellRight}>{r.required}</td>
                        <td style={tableCellRight}>{r.on_hand}</td>
                        <td style={tableCellRight}>{r.diff}</td>
                        <td
                          style={{
                            ...tableCellRight,
                            ...(r.shortage > 0
                              ? shortageCell
                              : shortageZeroCell),
                          }}
                        >
                          {r.shortage}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {productionList.length > 0 && cutSheetRowsFiltered.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h4 style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                    切断指示プレビュー（切断数ベース）
                  </h4>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCell}>長さ</th>
                        <th style={tableHeaderCellRight}>必要数</th>
                        <th style={tableHeaderCellRight}>在庫数</th>
                        <th style={cutQtyHeaderStyle}>切断数</th>
                        <th style={tableHeaderCell}>次工程</th>
                        <th style={tableHeaderCellRight}>総長</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cutSheetRowsFiltered.map((r) => (
                        <tr key={`${r.length_mm}-${r.tap}`}>
                          <td style={tableCell}>{formatLengthLabel(r.length_mm, r.tap)}</td>
                          <td style={tableCellRight}>{r.required}</td>
                          <td style={tableCellRight}>{r.on_hand}</td>
                          <td style={cutQtyCellStyle}>{r.cut_qty}</td>
                          <td style={tableCell}>{r.next_process}</td>
                          <td style={tableCellRight}>{formatTotalLengthMeters(r.total_cut_length_mm)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right", fontWeight: 600 }}>総長合計</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {formatTotalLengthMeters(
                            cutSheetRowsFiltered.reduce((s, r) => s + r.total_cut_length_mm, 0)
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <ul style={{ marginTop: 8, margin: 0, paddingLeft: 20, fontSize: 12, color: "#555" }}>
                    {cutSheetRowsFiltered.map((r) => (
                      <li key={`${r.length_mm}-${r.tap}`}>
                        {formatLengthLabel(r.length_mm, r.tap)}: {r.breakdown.length > 0 ? buildBreakdownText(r.breakdown) : "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      ) : tab === "inv" ? (
        <>
          {invLoading && (
            <div style={{ marginBottom: 12, fontSize: 14, color: "#6b7280" }}>
              読み込み中...
            </div>
          )}
          {saveError && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                color: "#b91c1c",
                fontSize: 14,
              }}
            >
              {saveError}
            </div>
          )}
          {saveSuccessMessage && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                color: "#166534",
                fontSize: 14,
              }}
            >
              {saveSuccessMessage}
            </div>
          )}
          <InventoryPanel
            inv={inv}
            onUpdate={updateInventory}
            savingInProgress={savingInProgress}
          />
        </>
      ) : tab === "bom" ? (
        <>
          {bomLoading && (
            <div style={{ marginBottom: 12, fontSize: 14, color: "#6b7280" }}>
              読み込み中...
            </div>
          )}
          {bomLoadError && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                color: "#b91c1c",
                fontSize: 14,
              }}
            >
              {bomLoadError}
            </div>
          )}
          {bomSaveError && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                color: "#b91c1c",
                fontSize: 14,
              }}
            >
              {bomSaveError}
            </div>
          )}
          {bomSaveSuccess && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                color: "#166534",
                fontSize: 14,
              }}
            >
              {bomSaveSuccess}
            </div>
          )}
          <BomPanel
            bom={bom}
            onSaveSelectedBom={saveSelectedBom}
            onApplyTemplate={applyTemplate}
            savingInProgress={bomSavingInProgress}
          />
        </>
      ) : null}
    </div>
  );
}

type EditableBomRow = {
  id: string;
  length_mm: number;
  tap: boolean;
  qty: number;
};

function BomPanel({
  bom,
  onSaveSelectedBom,
  onApplyTemplate,
  savingInProgress,
}: {
  bom: BomItem[];
  onSaveSelectedBom: (
    modelId: ModelId,
    size: string,
    stage: number,
    rows: { length_mm: number; tap: boolean; qty: number }[],
    confirmed: boolean
  ) => Promise<void>;
  onApplyTemplate: (
    templateModelId: TemplateModelId,
    size: TemplateSize,
    stage: number
  ) => Promise<"applied" | "not_defined">;
  savingInProgress: boolean;
}) {
  const [modelId, setModelId] = useState<ModelId>("cube");
  const [size, setSize] = useState("200x200");
  const [stage, setStage] = useState(1);
  const [bomEditorRows, setBomEditorRows] = useState<EditableBomRow[]>([]);
  const [selectedBomConfirmed, setSelectedBomConfirmed] = useState(false);
  const [bomUnlockedForEdit, setBomUnlockedForEdit] = useState(false);
  const [confirmCheckbox, setConfirmCheckbox] = useState(false);
  const [editorValidationError, setEditorValidationError] = useState<string | null>(null);

  const [templateModelId, setTemplateModelId] =
    useState<TemplateModelId>("cube");
  const [templateSize, setTemplateSize] = useState<TemplateSize>("200x200");
  const [templateStage, setTemplateStage] = useState(1);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);

  const selectedItems = useMemo(
    () =>
      bom.filter(
        (b) =>
          b.model_id === modelId && b.size === size && b.stage === stage
      ),
    [bom, modelId, size, stage]
  );

  useEffect(() => {
    setBomEditorRows(
      selectedItems.map((r) => ({
        id: crypto.randomUUID?.() ?? `row-${r.length_mm}-${r.tap}-${Date.now()}`,
        length_mm: r.length_mm,
        tap: r.tap,
        qty: r.qty_per_unit,
      }))
    );
    setSelectedBomConfirmed(selectedItems[0]?.confirmed ?? false);
    setConfirmCheckbox(selectedItems[0]?.confirmed ?? false);
    setBomUnlockedForEdit(false);
    setEditorValidationError(null);
  }, [modelId, size, stage, bom]);

  const isBomEditable = !selectedBomConfirmed || bomUnlockedForEdit;

  function updateRow(id: string, patch: Partial<EditableBomRow>) {
    setBomEditorRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    setEditorValidationError(null);
  }

  function removeRow(id: string) {
    setBomEditorRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addRow() {
    setBomEditorRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID?.() ?? `new-${Date.now()}`,
        length_mm: 0,
        tap: false,
        qty: 1,
      },
    ]);
    setEditorValidationError(null);
  }

  async function handleSave() {
    const invalid = bomEditorRows.some(
      (r) => !(r.length_mm > 0 && r.qty > 0)
    );
    if (invalid) {
      setEditorValidationError("長さ・必要本数は 1 以上を入力してください。");
      return;
    }
    setEditorValidationError(null);
    await onSaveSelectedBom(modelId, size, stage, bomEditorRows, confirmCheckbox);
  }

  function handleUnlock() {
    if (
      window.confirm(
        "この BOM は確定済みです。ロックを解除して編集しますか？"
      )
    ) {
      setBomUnlockedForEdit(true);
    }
  }

  async function handleApplyTemplate() {
    setTemplateMessage(null);
    const result = await onApplyTemplate(templateModelId, templateSize, templateStage);
    if (result === "not_defined") {
      setTemplateMessage("この条件のテンプレートは未登録です");
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 12 }}>BOM登録（■13 必要部材マスタ）</h3>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
          テンプレート生成
        </h4>
        <div style={filterRow}>
          <label style={selectLabel}>
            テンプレートモデル
            <select
              value={templateModelId}
              onChange={(e) => {
                setTemplateModelId((e.target.value as TemplateModelId) || "cube");
                setTemplateMessage(null);
              }}
              style={bigSelect}
              className="field-large"
            >
              {TEMPLATE_MODEL_IDS.map((id) => (
                <option key={id} value={id}>
                  {getModelLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <label style={selectLabel}>
            ラックサイズ
            <select
              value={templateSize}
              onChange={(e) => {
                setTemplateSize((e.target.value as TemplateSize) || "200x200");
                setTemplateMessage(null);
              }}
              style={bigSelect}
              className="field-large"
            >
              {TEMPLATE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={selectLabel}>
            段数
            <select
              value={templateStage}
              onChange={(e) => {
                setTemplateStage(parseInt(e.target.value, 10) || 1);
                setTemplateMessage(null);
              }}
              style={bigSelect}
              className="field-large"
            >
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}段
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleApplyTemplate}
            disabled={savingInProgress}
            style={secondaryButton}
          >
            {savingInProgress ? "適用中..." : "テンプレート生成"}
          </button>
        </div>
        {templateMessage && (
          <div
            style={{
              marginTop: 8,
              padding: 10,
              background: "#fef3c7",
              border: "1px solid #f59e0b",
              borderRadius: 6,
              color: "#92400e",
              fontSize: 13,
            }}
          >
            {templateMessage}
          </div>
        )}
      </div>

      <div style={filterRow}>
        <label style={selectLabel}>
          モデル
          <select
            value={modelId}
            onChange={(e) =>
              setModelId((e.target.value as ModelId) || "cube")
            }
            style={bigSelect}
            className="field-large"
          >
            {MODEL_IDS.map((id) => (
              <option key={id} value={id}>
                {getModelLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <label style={selectLabel}>
          ラックサイズ
          <select
            value={size}
            onChange={(e) =>
              setSize((e.target.value as BomSize) || "200x200")
            }
            style={bigSelect}
            className="field-large"
          >
            {BOM_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={selectLabel}>
          段数
          <select
            value={stage}
            onChange={(e) =>
              setStage(parseInt(e.target.value || "1", 10) || 1)
            }
            style={bigSelect}
            className="field-large"
          >
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}段
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedBomConfirmed && !bomUnlockedForEdit ? (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>確定済み（ロック中）</div>
          <div style={{ marginBottom: 8 }}>
            この BOM は確定済みです。編集するにはロック解除が必要です。
          </div>
          <button type="button" onClick={handleUnlock} style={secondaryButton}>
            ロック解除して編集
          </button>
        </div>
      ) : (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={confirmCheckbox}
              onChange={(e) => setConfirmCheckbox(e.target.checked)}
              disabled={!isBomEditable}
            />
            この BOM を確定する
          </label>
          {editorValidationError && (
            <div
              style={{
                padding: 10,
                marginBottom: 12,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                color: "#b91c1c",
                fontSize: 13,
              }}
            >
              {editorValidationError}
            </div>
          )}
          {bomEditorRows.length === 0 ? (
            <div
              style={{
                padding: 16,
                marginBottom: 12,
                background: "#f3f4f6",
                borderRadius: 8,
                color: "#6b7280",
                fontSize: 14,
              }}
            >
              この組み合わせのBOMは未登録です。行を追加して登録してください。
            </div>
          ) : null}
          <table style={table}>
            <thead>
              <tr>
                <th style={tableHeaderCell}>長さ</th>
                <th style={tableHeaderCell}>TAP</th>
                <th style={tableHeaderCellRight}>必要本数</th>
                <th style={tableHeaderCell}></th>
              </tr>
            </thead>
            <tbody>
              {bomEditorRows.map((r) => (
                <tr key={r.id}>
                  <td style={tableCell}>
                    <input
                      type="number"
                      min={1}
                      value={r.length_mm === 0 ? "" : r.length_mm}
                      onChange={(e) =>
                        updateRow(r.id, {
                          length_mm: e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0,
                        })
                      }
                      disabled={!isBomEditable}
                      style={{ ...bigInput, width: 90 }}
                      placeholder="長さ"
                    />
                  </td>
                  <td style={tableCell}>
                    <select
                      value={r.tap ? "1" : "0"}
                      onChange={(e) =>
                        updateRow(r.id, { tap: e.target.value === "1" })
                      }
                      disabled={!isBomEditable}
                      style={{ ...bigSelect, minWidth: 80 }}
                    >
                      <option value="0">TAP無</option>
                      <option value="1">TAP有</option>
                    </select>
                  </td>
                  <td style={tableCellRight}>
                    <input
                      type="number"
                      min={1}
                      value={r.qty === 0 ? "" : r.qty}
                      onChange={(e) =>
                        updateRow(r.id, {
                          qty: e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0,
                        })
                      }
                      disabled={!isBomEditable}
                      style={{ ...bigInput, width: 80 }}
                      placeholder="本数"
                    />
                  </td>
                  <td style={tableCell}>
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      disabled={!isBomEditable || savingInProgress}
                      style={{
                        ...secondaryButton,
                        padding: "4px 10px",
                        fontSize: 12,
                      }}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={addRow}
              disabled={!isBomEditable || savingInProgress}
              style={secondaryButton}
            >
              行追加
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={savingInProgress}
              style={primaryButton}
            >
              {savingInProgress ? "保存中..." : "保存"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function InventoryPanel({
  inv,
  onUpdate,
  savingInProgress,
}: {
  inv: InvItem[];
  onUpdate: (
    length_mm: number,
    tap: boolean,
    qty_on_hand: number
  ) => Promise<void>;
  savingInProgress: boolean;
}) {
  const [lengthMm, setLengthMm] = useState(0);
  const [tap, setTap] = useState(false);
  const [qty, setQty] = useState(0);

  const visibleInv = inv.filter((r) => r.qty_on_hand > 0);
  const sorted = [...visibleInv].sort(
    (a, b) =>
      a.length_mm - b.length_mm || Number(a.tap) - Number(b.tap)
  );

  return (
    <div>
      <h3 style={{ marginBottom: 12 }}>在庫（共通部材）</h3>

      <div style={filterRow}>
        <label style={selectLabel}>
          長さ(mm)
          <input
            type="number"
            value={lengthMm === 0 ? "" : lengthMm}
            onChange={(e) => {
              const v = e.target.value;
              setLengthMm(v === "" ? 0 : Number(v) || 0);
            }}
            placeholder="長さ"
            inputMode="numeric"
            style={bigInput}
            className="field-large"
          />
        </label>

        <label style={selectLabel}>
          TAP
          <select
            value={tap ? "1" : "0"}
            onChange={(e) => setTap(e.target.value === "1")}
            style={bigSelect}
            className="field-large"
          >
            <option value="0">TAP無</option>
            <option value="1">TAP有</option>
          </select>
        </label>

        <label style={selectLabel}>
          本数
          <input
            type="number"
            value={qty === 0 ? "" : qty}
            onChange={(e) => {
              const v = e.target.value;
              setQty(v === "" ? 0 : Number(v) || 0);
            }}
            placeholder="本数"
            inputMode="numeric"
            style={bigInput}
            className="field-large"
          />
        </label>

        <button
          onClick={() => onUpdate(lengthMm, tap, qty)}
          disabled={savingInProgress}
          style={secondaryButton}
        >
          {savingInProgress ? "保存中..." : "追加/更新"}
        </button>
      </div>

      <table style={table}>
        <thead>
          <tr>
            <th style={tableHeaderCell}>長さ</th>
            <th style={tableHeaderCell}>TAP</th>
            <th style={tableHeaderCellRight}>在庫</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={`${r.length_mm}-${r.tap}`}
              className="data-row"
            >
              <td style={tableCell}>{r.length_mm}mm</td>
              <td style={tableCell}>{r.tap ? "TAP有" : "TAP無"}</td>
              <td style={tableCellRight}>{r.qty_on_hand}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const selectLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 14,
  fontWeight: 600,
};

const bigSelect: React.CSSProperties = {
  fontSize: 18,
  padding: "10px 14px",
  minWidth: 160,
};

const bigInput: React.CSSProperties = {
  fontSize: 18,
  padding: "10px 14px",
  width: 100,
};

const appContainer: React.CSSProperties = {
  maxWidth: 1100,
  margin: "32px auto",
  padding: "0 16px 40px",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 24,
};

const headerTitle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
};

const tabRow: React.CSSProperties = {
  display: "inline-flex",
  borderRadius: 9999,
  backgroundColor: "#e5e7eb",
  padding: 4,
  marginBottom: 24,
};

const tabButton: React.CSSProperties = {
  borderRadius: 9999,
  border: "none",
  padding: "8px 20px",
  fontSize: 14,
  cursor: "pointer",
};

const tabButtonActive: React.CSSProperties = {
  backgroundColor: "#2563eb",
  color: "#ffffff",
  fontWeight: 600,
};

const tabButtonInactive: React.CSSProperties = {
  backgroundColor: "transparent",
  color: "#374151",
};

const filterRow: React.CSSProperties = {
  display: "flex",
  gap: 24,
  flexWrap: "wrap",
  alignItems: "flex-end",
};

const toolbarRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 12,
  marginBottom: 8,
};

const table: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  borderCollapse: "collapse",
};

const tableHeaderCell: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid #e5e7eb",
  backgroundColor: "#f3f4f6",
  fontSize: 13,
  fontWeight: 600,
};

const tableHeaderCellRight: React.CSSProperties = {
  ...tableHeaderCell,
  textAlign: "right",
};

const tableCell: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 14,
};

const tableCellRight: React.CSSProperties = {
  ...tableCell,
  textAlign: "right",
};

/** 切断数列を目立たせる（プレビュー・印刷で最重要） */
const cutQtyHeaderStyle: React.CSSProperties = {
  ...tableHeaderCellRight,
  backgroundColor: "#fef3c7",
  fontWeight: 700,
  fontSize: 14,
};

const cutQtyCellStyle: React.CSSProperties = {
  ...tableCellRight,
  backgroundColor: "#fef9c3",
  fontWeight: 700,
  fontSize: 15,
};

const shortageCell: React.CSSProperties = {
  color: "#b91c1c",
  fontWeight: 700,
};

const shortageZeroCell: React.CSSProperties = {
  color: "#9ca3af",
};

const rowSurplus: React.CSSProperties = {
  opacity: 0.75,
  color: "#6b7280",
};

const primaryButton: React.CSSProperties = {
  backgroundColor: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: 9999,
  padding: "8px 18px",
  fontSize: 14,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  backgroundColor: "#ffffff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 9999,
  padding: "8px 16px",
  fontSize: 14,
  cursor: "pointer",
};
