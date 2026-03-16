import { useCallback, useEffect, useMemo, useState } from "react";
import { getModelLabel, type BomItem, type ModelId } from "./lib/bomApi";
import type { InvItem } from "./lib/inventoryApi";
import {
  postIssueCut,
  type CutRowPayload,
  type IssueCutPart,
} from "./lib/issueCutApi";
import {
  expandProductionList,
  getPartWithBreakdown,
} from "./lib/productionList";
import type { ProductionItem } from "./types/cutIssue";

const STORAGE_KEY = "cutPreviewInit";

type PreviewProductionItem = ProductionItem & { id: string };

type PreviewCutRow = {
  key: string;
  length_mm: number;
  tap: boolean;
  required: number;
  on_hand: number;
  cut_qty: number;
  manualRequired: boolean;
  manualCutQty: boolean;
  breakdown: { label: string; qty: number }[];
};

type StoredInit = {
  productionList: ProductionItem[];
  bom: BomItem[];
  inventory: InvItem[];
};

function partKey(length_mm: number, tap: boolean): string {
  return `${length_mm}|${tap ? 1 : 0}`;
}

function formatLengthLabel(length_mm: number, tap: boolean): string {
  return tap ? `${length_mm}mm (TAP)` : `${length_mm}mm`;
}

function formatTotalLengthMeters(totalMm: number): string {
  return `${(totalMm / 1000).toFixed(2)}m`;
}

function buildBreakdownText(breakdown: { label: string; qty: number }[]): string {
  return breakdown.map((x) => `${x.label}:${x.qty}本`).join(" / ");
}

function aggregateRequired(
  expandedList: { length_mm: number; tap: boolean; qty: number }[]
): Map<string, { length_mm: number; tap: number; required: number }> {
  const map = new Map<
    string,
    { length_mm: number; tap: number; required: number }
  >();
  for (const e of expandedList) {
    const key = partKey(e.length_mm, e.tap);
    const prev = map.get(key);
    if (prev) prev.required += e.qty;
    else
      map.set(key, {
        length_mm: e.length_mm,
        tap: e.tap ? 1 : 0,
        required: e.qty,
      });
  }
  return map;
}

export default function CutPreview() {
  const [initError, setInitError] = useState<string | null>(null);
  const [productionList, setProductionList] = useState<PreviewProductionItem[]>(
    []
  );
  const [cutRows, setCutRows] = useState<PreviewCutRow[]>([]);
  const [confirmedIssueId, setConfirmedIssueId] = useState<string | null>(null);
  const [confirmedParts, setConfirmedParts] = useState<IssueCutPart[] | null>(
    null
  );
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const invMap = useMemo(() => {
    const m = new Map<string, number>();
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return m;
      const data = JSON.parse(raw) as StoredInit;
      const inv = data?.inventory ?? [];
      for (const it of inv) {
        const tap = "tap" in it && typeof it.tap === "boolean" ? it.tap : false;
        m.set(partKey(it.length_mm, tap), it.qty_on_hand);
      }
    } catch {
      // ignore
    }
    return m;
  }, []);

  const bom = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw) as StoredInit;
      return data?.bom ?? [];
    } catch {
      return [];
    }
  }, []);

  const recalcCutRows = useCallback(
    (prods: PreviewProductionItem[], existing: PreviewCutRow[]): PreviewCutRow[] => {
      const expandedList = expandProductionList(
        prods,
        bom,
        (id) => getModelLabel(id as ModelId)
      );
      const partWithBreakdown = getPartWithBreakdown(expandedList);
      const reqMap = aggregateRequired(expandedList);
      const existingByKey = new Map(existing.map((r) => [r.key, r]));
      const next: PreviewCutRow[] = [];
      for (const p of partWithBreakdown) {
        const key = partKey(p.length_mm, p.tap);
        const req = reqMap.get(key);
        const required = req?.required ?? 0;
        const on_hand = invMap.get(key) ?? 0;
        const prev = existingByKey.get(key);
        const manualRequired = prev?.manualRequired ?? false;
        const manualCutQty = prev?.manualCutQty ?? false;
        const reqVal = manualRequired && prev ? prev.required : required;
        const cutVal =
          manualCutQty && prev
            ? prev.cut_qty
            : Math.max(0, reqVal - on_hand);
        next.push({
          key,
          length_mm: p.length_mm,
          tap: p.tap,
          required: reqVal,
          on_hand,
          cut_qty: cutVal,
          manualRequired,
          manualCutQty,
          breakdown: p.breakdown,
        });
      }
      next.sort(
        (a, b) =>
          a.length_mm - b.length_mm || Number(a.tap) - Number(b.tap)
      );
      return next;
    },
    [bom, invMap]
  );

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setInitError("データがありません");
        return;
      }
      const data = JSON.parse(raw) as StoredInit;
      if (!data?.productionList?.length || !Array.isArray(data.bom)) {
        setInitError("データが不正です");
        return;
      }
      const prods: PreviewProductionItem[] = data.productionList.map(
        (p, i) => ({
          ...p,
          id: (p as { id?: string }).id ?? `p-${i}-${Date.now()}`,
        })
      );
      setProductionList(prods);
      setCutRows(recalcCutRows(prods, []));
    } catch {
      setInitError("データの読み込みに失敗しました");
    }
  }, [recalcCutRows]);

  useEffect(() => {
    if (productionList.length === 0) return;
    setCutRows((prev) => recalcCutRows(productionList, prev));
  }, [productionList, recalcCutRows]);

  const updateProductionQty = useCallback((id: string, qty: number) => {
    setProductionList((prev) =>
      prev.map((p) => (p.id === id ? { ...p, qty: Math.max(0, qty) } : p))
    );
  }, []);

  const updateCutRowRequired = useCallback((key: string, required: number) => {
    setCutRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? {
              ...r,
              required: Math.max(0, required),
              manualRequired: true,
            }
          : r
      )
    );
  }, []);

  const updateCutRowCutQty = useCallback((key: string, cut_qty: number) => {
    setCutRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? {
              ...r,
              cut_qty: Math.max(0, cut_qty),
              manualCutQty: true,
            }
          : r
      )
    );
  }, []);

  const summaryLines = useMemo(
    () =>
      productionList.map(
        (p) =>
          `${getModelLabel(p.model_id as ModelId)} / ${p.size} / ${p.stage}段 / ${p.qty}台`
      ),
    [productionList]
  );

  const totalCutMm = useMemo(
    () => cutRows.reduce((s, r) => s + r.length_mm * r.cut_qty, 0),
    [cutRows]
  );

  const handleConfirm = useCallback(async () => {
    if (productionList.length === 0 || cutRows.length === 0) return;
    setConfirmError(null);
    setConfirmLoading(true);
    try {
      const cut_rows: CutRowPayload[] = cutRows.map((r) => ({
        length_mm: r.length_mm,
        tap: r.tap,
        required: r.required,
        cut_qty: r.cut_qty,
      }));
      const res = await postIssueCut(productionList, cut_rows);
      setConfirmedIssueId(res.issue_id);
      setConfirmedParts(res.parts ?? null);
      if (window.opener) {
        try {
          window.opener.postMessage(
            {
              type: "cut-issued",
              issue_id: res.issue_id,
              parts: res.parts,
            },
            window.location.origin
          );
        } catch {
          // ignore
        }
      }
    } catch (err) {
      setConfirmError((err as Error)?.message ?? "確定に失敗しました");
    } finally {
      setConfirmLoading(false);
    }
  }, [productionList, cutRows]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 8,
    fontSize: 14,
  };
  const thStyle: React.CSSProperties = {
    padding: "8px 10px",
    border: "1px solid #333",
    background: "#f3f4f6",
    fontWeight: 600,
    textAlign: "left",
  };
  const tdStyle: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #333",
  };
  const inputStyle: React.CSSProperties = {
    width: 64,
    padding: "4px 6px",
    fontSize: 14,
  };

  if (initError) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <p style={{ color: "#b91c1c" }}>{initError}</p>
        <button type="button" onClick={handleClose} style={{ marginTop: 12 }}>
          閉じる
        </button>
      </div>
    );
  }

  if (confirmedIssueId) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 900 }}>
        <h2 style={{ marginBottom: 8 }}>切断指示書（確定済み）</h2>
        <p style={{ fontWeight: 600, marginBottom: 16 }}>
          issue_id: {confirmedIssueId}
        </p>
        {confirmedParts && confirmedParts.length > 0 && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>長さ</th>
                <th style={{ ...thStyle, textAlign: "right" }}>切断数</th>
                <th style={thStyle}>次工程</th>
                <th style={{ ...thStyle, textAlign: "right" }}>総長</th>
              </tr>
            </thead>
            <tbody>
              {confirmedParts.map((p, i) => (
                <tr key={i}>
                  <td style={tdStyle}>
                    {formatLengthLabel(p.length_mm, p.tap)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{p.qty}</td>
                  <td style={tdStyle}>
                    {p.tap ? "MC (TAP加工)" : "溶接"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {formatTotalLengthMeters(p.length_mm * p.qty)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                  総長合計
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                  {formatTotalLengthMeters(
                    confirmedParts.reduce(
                      (s, p) => s + p.length_mm * p.qty,
                      0
                    )
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <button type="button" onClick={handlePrint} style={{ padding: "8px 16px" }}>
            印刷
          </button>
          <button type="button" onClick={handleClose} style={{ padding: "8px 16px" }}>
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 900 }}>
      <h2 style={{ marginBottom: 4 }}>切断指示プレビュー</h2>
      <p
        style={{
          marginBottom: 16,
          padding: 8,
          background: "#fef3c7",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        参考用 / 未確定（この内容で確定するまで在庫は変わりません）
      </p>

      <h3 style={{ fontSize: 16, marginBottom: 8 }}>品名</h3>
      <ul style={{ margin: "0 0 16px 0", paddingLeft: 20 }}>
        {summaryLines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      <h3 style={{ fontSize: 16, marginBottom: 8 }}>製作予定</h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>モデル</th>
            <th style={thStyle}>サイズ</th>
            <th style={thStyle}>段数</th>
            <th style={thStyle}>台数</th>
          </tr>
        </thead>
        <tbody>
          {productionList.map((p) => (
            <tr key={p.id}>
              <td style={tdStyle}>
                {getModelLabel(p.model_id as ModelId)}
              </td>
              <td style={tdStyle}>{p.size}</td>
              <td style={tdStyle}>{p.stage}段</td>
              <td style={tdStyle}>
                <input
                  type="number"
                  min={1}
                  value={p.qty}
                  onChange={(e) =>
                    updateProductionQty(
                      p.id,
                      parseInt(e.target.value, 10) || 0
                    )
                  }
                  style={inputStyle}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>
        切断指示
      </h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>長さ</th>
            <th style={{ ...thStyle, textAlign: "right" }}>必要数</th>
            <th style={{ ...thStyle, textAlign: "right" }}>在庫数</th>
            <th style={{ ...thStyle, textAlign: "right" }}>切断数</th>
            <th style={thStyle}>次工程</th>
            <th style={{ ...thStyle, textAlign: "right" }}>総長</th>
          </tr>
        </thead>
        <tbody>
          {cutRows.map((r) => (
            <tr key={r.key}>
              <td style={tdStyle}>{formatLengthLabel(r.length_mm, r.tap)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                <input
                  type="number"
                  min={0}
                  value={r.required}
                  onChange={(e) =>
                    updateCutRowRequired(
                      r.key,
                      parseInt(e.target.value, 10) || 0
                    )
                  }
                  style={inputStyle}
                />
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{r.on_hand}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                <input
                  type="number"
                  min={0}
                  value={r.cut_qty}
                  onChange={(e) =>
                    updateCutRowCutQty(
                      r.key,
                      parseInt(e.target.value, 10) || 0
                    )
                  }
                  style={{ ...inputStyle, backgroundColor: "#fef9c3" }}
                />
              </td>
              <td style={tdStyle}>
                {r.tap ? "MC (TAP加工)" : "溶接"}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {formatTotalLengthMeters(r.length_mm * r.cut_qty)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={5}
              style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}
            >
              総長合計
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
              {formatTotalLengthMeters(totalCutMm)}
            </td>
          </tr>
        </tfoot>
      </table>
      {cutRows.map(
        (r) =>
          r.breakdown.length > 0 && (
            <div
              key={`b-${r.key}`}
              style={{
                fontSize: 12,
                color: "#555",
                marginBottom: 4,
                paddingLeft: 12,
              }}
            >
              {formatLengthLabel(r.length_mm, r.tap)}:{" "}
              {buildBreakdownText(r.breakdown)}
            </div>
          )
      )}

      {confirmError && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          {confirmError}
        </div>
      )}

      <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmLoading || productionList.length === 0}
          style={{
            padding: "10px 20px",
            fontSize: 16,
            fontWeight: 600,
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: confirmLoading ? "wait" : "pointer",
          }}
        >
          {confirmLoading ? "処理中..." : "この内容で確定"}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          style={{ padding: "10px 20px", fontSize: 14 }}
        >
          印刷
        </button>
        <button
          type="button"
          onClick={handleClose}
          style={{ padding: "10px 20px", fontSize: 14 }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
