import { useEffect, useMemo, useState } from "react";
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

const STAGE_OPTIONS = [1, 2, 3, 4, 5];
const LENGTH_OPTIONS = [205, 231, 410, 436, 859, 1282, 1679, 1705, 2102, 2128];

type NeedRow = {
  length_mm: number;
  screw: boolean;
  required: number;
  on_hand: number;
  shortage: number;
};

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
      m.set(`${it.length_mm}|${it.screw ? 1 : 0}`, it.qty_on_hand);
    }
    return m;
  }, [inv]);

  // -------------------------
  // Calculate
  // -------------------------
  const needRows: NeedRow[] = useMemo(() => {
    const filtered = bom.filter(
      (b) =>
        b.model_id === modelId && b.size === size && b.stage === stage
    );

    const reqMap = new Map<
      string,
      { length_mm: number; screw: boolean; required: number }
    >();

    for (const b of filtered) {
      const key = `${b.length_mm}|${b.screw ? 1 : 0}`;
      const add = b.qty_per_unit * units;

      const prev = reqMap.get(key);
      if (prev) prev.required += add;
      else
        reqMap.set(key, {
          length_mm: b.length_mm,
          screw: b.screw,
          required: add,
        });
    }

    const out: NeedRow[] = [];

    for (const v of reqMap.values()) {
      const onHand = invMap.get(
        `${v.length_mm}|${v.screw ? 1 : 0}`
      ) ?? 0;

      const shortage = Math.max(v.required - onHand, 0);

      if (showShortageOnly && shortage <= 0) continue;

      out.push({
        length_mm: v.length_mm,
        screw: v.screw,
        required: v.required,
        on_hand: onHand,
        shortage,
      });
    }

    out.sort(
      (a, b) =>
        b.shortage - a.shortage ||
        a.length_mm - b.length_mm ||
        Number(a.screw) - Number(b.screw)
    );

    return out;
  }, [bom, invMap, modelId, size, stage, units, showShortageOnly]);

  const showBomWarning = bom.length === 0;

  async function updateInventory(
    length_mm: number,
    screw: boolean,
    qty_on_hand: number
  ) {
    setSaveError(null);
    setSaveSuccessMessage(null);
    setSavingInProgress(true);
    const key = `${length_mm}|${screw ? 1 : 0}`;
    const next = inv.filter(
      (it) => `${it.length_mm}|${it.screw ? 1 : 0}` !== key
    );
    next.push({ length_mm, screw, qty_on_hand });
    next.sort(
      (a, b) =>
        a.length_mm - b.length_mm || Number(a.screw) - Number(b.screw)
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
    return `${item.model_id}|${item.size}|${item.stage}|${item.length_mm}|${item.screw ? 1 : 0}`;
  }

  async function addOrUpdateBom(item: BomItem) {
    if (item.qty_per_unit <= 0) return;
    setBomSaveError(null);
    setBomSaveSuccess(null);
    setBomSavingInProgress(true);
    const key = bomRowKey(item);
    const next = bom.filter((b) => bomRowKey(b) !== key);
    next.push(item);
    const sorted = sortBomItems(next);
    try {
      await saveBom(sorted);
      setBom(sorted);
      setBomSaveSuccess("保存しました");
      window.setTimeout(() => setBomSaveSuccess(null), 2000);
    } catch (err) {
      console.error("saveBom failed:", err);
      setBomSaveError((err as Error)?.message ?? "BOMの保存に失敗しました");
    } finally {
      setBomSavingInProgress(false);
    }
  }

  async function deleteBomRow(item: BomItem) {
    setBomSaveError(null);
    setBomSavingInProgress(true);
    const next = bom.filter((b) => bomRowKey(b) !== bomRowKey(item));
    const sorted = sortBomItems(next);
    try {
      await saveBom(sorted);
      setBom(sorted);
    } catch (err) {
      console.error("saveBom failed:", err);
      setBomSaveError((err as Error)?.message ?? "BOMの削除に失敗しました");
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
      .map(
        (r) =>
          `${r.length_mm}mm\t${r.screw ? "ネジ有" : "ネジ無"}\t${r.shortage}本`
      );

    const text = lines.length ? lines.join("\n") : "不足なし";
    await navigator.clipboard.writeText(text);
    alert("コピーしました");
  }

  function printCutSheet() {
    const rows = needRows;
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
    const productName = `${getModelLabel(modelId)} ${size} ${stage}段`;

    const KERF_MM = 3;
    let initialTotalMm = 0;
    const tableRows = rows
      .map(
        (r, i) => {
          const totalMm =
            r.shortage <= 0
              ? 0
              : r.length_mm * r.shortage + KERF_MM * (r.shortage - 1);
          initialTotalMm += totalMm;
          const requiredPerUnit = units > 0 ? Math.round(r.required / units) : r.required;
          return `<tr data-length-mm="${r.length_mm}" data-required-per-unit="${requiredPerUnit}">
            <td>${i + 1}</td>
            <td>SS黒皮</td>
            <td>■13x${r.length_mm}</td>
            <td class="editable-required" contenteditable="true">${r.required}</td>
            <td class="editable-onhand" contenteditable="true">${r.on_hand}</td>
            <td class="cut-qty calc-shortage">${r.shortage}</td>
            <td>${r.screw ? "MC (TAP加工)" : "溶接"}</td>
            <td class="total-length calc-total">${totalMm}</td>
          </tr>`;
        }
      )
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
  .header-units { display: flex; align-items: center; gap: 6px; }
  .header-units [contenteditable="true"] { min-width: 2.5em; text-align: right; }
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
  [contenteditable="true"] { outline: 1px dotted #999; }
  @media print {
    .toolbar { display: none !important; }
    @page { size: A4 landscape; margin: 15mm; }
    body { font-family: sans-serif; }
    [contenteditable="true"] { outline: none; }
    tbody tr:nth-child(even) { background: #f0f0f0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">印刷</button>
  </div>
  <div class="header">
    <span class="product">品名：${productName}</span>
    <span class="header-units">製作台数：<span id="units-input" contenteditable="true">${units}</span>台</span>
    <span>発注日：${dateStr}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>材種</th>
        <th>サイズ</th>
        <th>必要数</th>
        <th>在庫数</th>
        <th class="cut-qty">切断数</th>
        <th>次工程</th>
        <th class="total-length">総長(mm)</th>
      </tr>
    </thead>
    <tbody>${tableRows.length ? tableRows : "<tr><td colspan=\"8\">切断必要なし</td></tr>"}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="7" style="text-align: right; font-weight: 600;">総長合計</td>
        <td id="total-length-sum" class="total-length" style="font-weight: 600;">${initialTotalMm}</td>
      </tr>
    </tfoot>
  </table>
  <script>
    (function() {
      var KERF = 3;
      function updateTotalLength() {
        var sum = 0;
        [].forEach.call(document.querySelectorAll(".calc-total"), function(td) {
          sum += parseInt(td.textContent.trim(), 10) || 0;
        });
        var el = document.getElementById("total-length-sum");
        if (el) el.textContent = sum;
      }
      function recalcRow(tr) {
        var len = parseInt(tr.getAttribute("data-length-mm"), 10);
        if (isNaN(len)) return;
        var reqCell = tr.querySelector(".editable-required");
        if (!reqCell) return;
        var required = parseInt(reqCell.textContent.trim(), 10) || 0;
        var onhand = parseInt(tr.querySelector(".editable-onhand").textContent.trim(), 10) || 0;
        var shortage = Math.max(0, required - onhand);
        var total = shortage <= 0 ? 0 : len * shortage + KERF * (shortage - 1);
        tr.querySelector(".calc-shortage").textContent = shortage;
        tr.querySelector(".calc-total").textContent = total;
        updateTotalLength();
      }
      function recalcAllFromUnits() {
        var u = parseInt(document.getElementById("units-input").textContent.trim(), 10) || 0;
        var per = Math.max(0, u);
        [].forEach.call(document.querySelectorAll("tr[data-required-per-unit]"), function(tr) {
          var rpu = parseInt(tr.getAttribute("data-required-per-unit"), 10) || 0;
          tr.querySelector(".editable-required").textContent = rpu * per;
          recalcRow(tr);
        });
        updateTotalLength();
      }
      function init() {
        var tbody = document.querySelector("table tbody");
        if (!tbody) return;
        [].forEach.call(tbody.querySelectorAll("tr[data-length-mm]"), function(tr) {
          [].forEach.call(tr.querySelectorAll(".editable-required, .editable-onhand"), function(cell) {
            cell.addEventListener("input", function() { recalcRow(tr); });
          });
        });
        var unitsEl = document.getElementById("units-input");
        if (unitsEl) unitsEl.addEventListener("input", recalcAllFromUnits);
        updateTotalLength();
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
      else init();
    })();
  </script>
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

            <div style={{ display: "flex", gap: 8 }}>
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
            </div>
          </div>

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
            <table style={table}>
              <thead>
                <tr>
                  <th style={tableHeaderCell}>長さ</th>
                  <th style={tableHeaderCell}>ネジ</th>
                  <th style={tableHeaderCellRight}>必要</th>
                  <th style={tableHeaderCellRight}>在庫</th>
                  <th style={tableHeaderCellRight}>切る必要</th>
                </tr>
              </thead>
              <tbody>
                {needRows.map((r) => {
                  const hasSurplus =
                    r.shortage === 0 && r.on_hand >= r.required;
                  return (
                    <tr
                      key={`${r.length_mm}-${r.screw}`}
                      className="data-row"
                      style={
                        hasSurplus ? rowSurplus : undefined
                      }
                    >
                      <td style={tableCell}>{r.length_mm}mm</td>
                      <td style={tableCell}>{r.screw ? "有" : "無"}</td>
                      <td style={tableCellRight}>{r.required}</td>
                      <td style={tableCellRight}>{r.on_hand}</td>
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
            onAddOrUpdate={addOrUpdateBom}
            onDelete={deleteBomRow}
            onApplyTemplate={applyTemplate}
            savingInProgress={bomSavingInProgress}
          />
        </>
      ) : null}
    </div>
  );
}

function BomPanel({
  bom,
  onAddOrUpdate,
  onDelete,
  onApplyTemplate,
  savingInProgress,
}: {
  bom: BomItem[];
  onAddOrUpdate: (item: BomItem) => Promise<void>;
  onDelete: (item: BomItem) => Promise<void>;
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
  const [lengthMm, setLengthMm] = useState(205);
  const [screw, setScrew] = useState(false);
  const [qtyPerUnit, setQtyPerUnit] = useState(1);

  const [templateModelId, setTemplateModelId] =
    useState<TemplateModelId>("cube");
  const [templateSize, setTemplateSize] = useState<TemplateSize>("200x200");
  const [templateStage, setTemplateStage] = useState(1);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);

  const sorted = sortBomItems(bom);

  const handleSubmit = () => {
    const qty = Math.max(0, Math.floor(qtyPerUnit));
    if (qty <= 0) return;
    onAddOrUpdate({
      model_id: modelId,
      model: getModelLabel(modelId),
      size,
      stage,
      length_mm: lengthMm,
      screw,
      qty_per_unit: qty,
    });
  };

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
          段数（候補 1～5、手入力可）
          <input
            type="number"
            min={1}
            value={stage}
            onChange={(e) =>
              setStage(parseInt(e.target.value || "1", 10))
            }
            list="bom-stage-list"
            style={bigInput}
            className="field-large"
          />
          <datalist id="bom-stage-list">
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label style={selectLabel}>
          部材長さ
          <input
            type="number"
            min={1}
            value={lengthMm}
            onChange={(e) =>
              setLengthMm(parseInt(e.target.value || "205", 10))
            }
            list="bom-length-list"
            style={bigInput}
            className="field-large"
          />
          <datalist id="bom-length-list">
            {LENGTH_OPTIONS.map((L) => (
              <option key={L} value={L} />
            ))}
          </datalist>
        </label>
        <label style={selectLabel}>
          ネジ
          <select
            value={screw ? "1" : "0"}
            onChange={(e) => setScrew(e.target.value === "1")}
            style={bigSelect}
            className="field-large"
          >
            <option value="0">無</option>
            <option value="1">有</option>
          </select>
        </label>
        <label style={selectLabel}>
          必要本数
          <input
            type="number"
            min={1}
            value={qtyPerUnit}
            onChange={(e) =>
              setQtyPerUnit(parseInt(e.target.value || "1", 10))
            }
            style={bigInput}
            className="field-large"
          />
        </label>
        <button
          onClick={handleSubmit}
          disabled={savingInProgress}
          style={secondaryButton}
        >
          {savingInProgress ? "保存中..." : "追加/更新"}
        </button>
      </div>
      <table style={table}>
        <thead>
          <tr>
            <th style={tableHeaderCell}>モデル</th>
            <th style={tableHeaderCell}>ラックサイズ</th>
            <th style={tableHeaderCell}>段数</th>
            <th style={tableHeaderCell}>部材サイズ</th>
            <th style={tableHeaderCell}>ネジ</th>
            <th style={tableHeaderCellRight}>必要本数</th>
            <th style={tableHeaderCell}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.model_id}-${r.size}-${r.stage}-${r.length_mm}-${r.screw}`} className="data-row">
              <td style={tableCell}>{r.model}</td>
              <td style={tableCell}>{r.size}</td>
              <td style={tableCell}>{r.stage}</td>
              <td style={tableCell}>■13x{r.length_mm}</td>
              <td style={tableCell}>{r.screw ? "有" : "無"}</td>
              <td style={tableCellRight}>{r.qty_per_unit}</td>
              <td style={tableCell}>
                <button
                  type="button"
                  onClick={() => onDelete(r)}
                  disabled={savingInProgress}
                  style={{ ...secondaryButton, padding: "4px 10px", fontSize: 12 }}
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
    screw: boolean,
    qty_on_hand: number
  ) => Promise<void>;
  savingInProgress: boolean;
}) {
  const [lengthMm, setLengthMm] = useState(0);
  const [screw, setScrew] = useState(false);
  const [qty, setQty] = useState(0);

  const visibleInv = inv.filter((r) => r.qty_on_hand > 0);
  const sorted = [...visibleInv].sort(
    (a, b) =>
      a.length_mm - b.length_mm || Number(a.screw) - Number(b.screw)
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
          ネジ
          <select
            value={screw ? "1" : "0"}
            onChange={(e) => setScrew(e.target.value === "1")}
            style={bigSelect}
            className="field-large"
          >
            <option value="0">無</option>
            <option value="1">有</option>
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
          onClick={() => onUpdate(lengthMm, screw, qty)}
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
            <th style={tableHeaderCell}>ネジ</th>
            <th style={tableHeaderCellRight}>在庫</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={`${r.length_mm}-${r.screw}`}
              className="data-row"
            >
              <td style={tableCell}>{r.length_mm}mm</td>
              <td style={tableCell}>{r.screw ? "有" : "無"}</td>
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
