export type ProductionItem = {
  model_id: string;
  size: string;
  stage: number;
  qty: number;
};

export type CutIssuePart = {
  length_mm: number;
  tap: boolean;
  qty: number;
};

export type CutIssue = {
  issue_id: string;
  created_at: string;
  productions: ProductionItem[];
  parts: CutIssuePart[];
  inventory_applied: boolean;
};
