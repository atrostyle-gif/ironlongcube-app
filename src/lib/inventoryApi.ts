import { normalizeTap } from "./tapNormalize";

// 相対パスのため netlify dev および本番デプロイどちらでも同一オリジンで動作
const INVENTORY_API = "/.netlify/functions/inventory";

export type InvItem = {
  length_mm: number;
  tap: boolean;
  qty_on_hand: number;
};

export async function fetchInventory(): Promise<InvItem[]> {
  const res = await fetch(INVENTORY_API, { method: "GET" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ??
        `在庫の読み込みに失敗しました (${res.status})`
    );
  }
  const data = (await res.json()) as { items?: Array<{ length_mm?: number; tap?: boolean; screw?: boolean; qty_on_hand?: number }> };
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((it) => ({
    length_mm: Number(it.length_mm),
    tap: normalizeTap(it),
    qty_on_hand: Number(it.qty_on_hand),
  }));
}

export async function saveInventory(items: InvItem[]): Promise<void> {
  const res = await fetch(INVENTORY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ??
        `在庫の保存に失敗しました (${res.status})`
    );
  }
}
