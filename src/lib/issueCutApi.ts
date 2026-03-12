import type { ProductionItem } from "../types/cutIssue";

const ISSUE_CUT_API = "/.netlify/functions/issue-cut";

export type IssueCutPart = {
  length_mm: number;
  tap: boolean;
  qty: number;
};

export type IssueCutResponse = {
  issue_id: string;
  parts: IssueCutPart[];
};

export async function postIssueCut(
  productions: ProductionItem[]
): Promise<IssueCutResponse> {
  const res = await fetch(ISSUE_CUT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productions }),
  });
  const data = (await res.json()) as {
    issue_id?: string;
    parts?: IssueCutPart[];
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
  return { issue_id: data.issue_id, parts: data.parts };
}
