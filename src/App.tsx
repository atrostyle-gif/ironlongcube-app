import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { bomData } from "./data/bomData";
import {
  fetchInventory,
  saveInventory,
  type InvItem,
} from "./lib/inventoryApi";

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

  const [tab, setTab] = useState<"make" | "inv">("make");

  const [model, setModel] = useState("CUBE");
  const [size, setSize] = useState("200x200");
  const [stage, setStage] = useState(1);
  const [units, setUnits] = useState(1);

  const [showShortageOnly, setShowShortageOnly] = useState(false);

  const bom = bomData;

  // -------------------------
  // Load inventory from API
  // -------------------------
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

  // -------------------------
  // Option Lists
  // -------------------------
  const models = useMemo(
    () => Array.from(new Set(bom.map((x) => x.model))).sort(),
    [bom]
  );

  const sizes = useMemo(() => {
    const s = bom.filter((x) => x.model === model).map((x) => x.size);
    return Array.from(new Set(s)).sort();
  }, [bom, model]);

  const stages = useMemo(() => {
    const s = bom
      .filter((x) => x.model === model && x.size === size)
      .map((x) => x.stage);
    return Array.from(new Set(s)).sort((a, b) => a - b);
  }, [bom, model, size]);

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
      (b) => b.model === model && b.size === size && b.stage === stage
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
  }, [bom, invMap, model, size, stage, units, showShortageOnly]);

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
    const rows = needRows.filter((r) => r.shortage > 0);
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
    const productName = `${model} ${size} ${stage}段`;

    const tableRows = rows
      .map(
        (r, i) =>
          `<tr>
            <td>${i + 1}</td>
            <td>SS黒皮</td>
            <td>■13x${r.length_mm}</td>
            <td>${r.on_hand}</td>
            <td>${r.shortage}</td>
            <td>${r.screw ? "MC" : "溶接"}</td>
          </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>切断指示書</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: sans-serif; margin: 0; padding: 15mm; }
  .header { display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 14px; }
  .product { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
  th { background: #eee; font-weight: 600; }
  td:nth-child(1), td:nth-child(4), td:nth-child(5) { text-align: right; }
  @media print {
    @page { size: A4; margin: 15mm; }
    body { font-family: sans-serif; }
  }
</style>
</head>
<body>
  <div class="header">
    <span class="product">品名：${productName}</span>
    <span>発注日：${dateStr}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>材質</th>
        <th>サイズ</th>
        <th>在庫数</th>
        <th>切断本数</th>
        <th>工程</th>
      </tr>
    </thead>
    <tbody>${tableRows || "<tr><td colspan=\"6\">切断必要なし</td></tr>"}</tbody>
  </table>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("ポップアップがブロックされています。印刷するには許可してください。");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.onload = () => w.print();
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
      </div>

      {tab === "make" ? (
        <>
          <div style={filterRow}>
            <label style={selectLabel}>
              型
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={bigSelect}
                className="field-large"
              >
                {models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>

            <label style={selectLabel}>
              サイズ
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                style={bigSelect}
                className="field-large"
              >
                {sizes.map((s) => (
                  <option key={s}>{s}</option>
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
              >
                {stages.map((s) => (
                  <option key={s}>{s}段</option>
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
              {needRows.map((r) => (
                <tr
                  key={`${r.length_mm}-${r.screw}`}
                  className="data-row"
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
              ))}
            </tbody>
          </table>
        </>
      ) : (
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
    screw: boolean,
    qty_on_hand: number
  ) => Promise<void>;
  savingInProgress: boolean;
}) {
  const [lengthMm, setLengthMm] = useState(205);
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
            value={lengthMm}
            onChange={(e) =>
              setLengthMm(parseInt(e.target.value || "0", 10))
            }
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
            value={qty}
            onChange={(e) =>
              setQty(parseInt(e.target.value || "0", 10))
            }
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
