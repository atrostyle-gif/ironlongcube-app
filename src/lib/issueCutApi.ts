import type { ProductionItem } from "../types/cutIssue";

const ISSUE_CUT_API = "/.netlify/functions/issue-cut";

export type IssueCutPart = {
  length_mm: number;
  tap: boolean;
  qty: number;
};

export type CutRowPayload = {
  length_mm: number;
  tap: boolean;
  required: number;
  cut_qty: number;
};

export type IssueCutResponse = {
  issue_id: string;
  parts: IssueCutPart[];
  cut_rows?: CutRowPayload[] | null;
};

export async function postIssueCut(
  productions: ProductionItem[],
  cut_rows?: CutRowPayload[]
): Promise<IssueCutResponse> {
  const body: { productions: ProductionItem[]; cut_rows?: CutRowPayload[] } = {
    productions,
  };
  if (cut_rows != null && cut_rows.length > 0) {
    body.cut_rows = cut_rows;
  }
  const res = await fetch(ISSUE_CUT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    issue_id?: string;
    parts?: IssueCutPart[];
    cut_rows?: CutRowPayload[] | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    const msg =
      data?.error === "insufficient inventory"
        ? "在庫が不足しています"
        : data?.error ?? data?.message ?? `切断指示の確定に失敗しました (${res.status})`;
    throw new Error(msg);
  }
  if (!data.issue_id || !Array.isArray(data.parts)) {
    throw new Error("Invalid response from issue-cut");
  }
  return {
    issue_id: data.issue_id,
    parts: data.parts,
    cut_rows: data.cut_rows ?? null,
  };
}
