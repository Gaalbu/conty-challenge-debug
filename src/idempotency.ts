export function normalizeKey(key: string): string {
  return key.replace(/[\p{Cf}\p{Z}\s]+/gu, "").toLowerCase();
}
