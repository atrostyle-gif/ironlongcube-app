/**
 * 既存データ互換: 読込時に tap が無ければ screw を tap として扱う。
 * 保存時は tap のみ使用し、screw は出力しない。
 */
export function normalizeTap(value: { tap?: boolean; screw?: boolean }): boolean {
  if (typeof value.tap === "boolean") return value.tap;
  if (typeof value.screw === "boolean") return value.screw;
  return false;
}
