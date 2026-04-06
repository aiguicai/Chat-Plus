export function normalizeSiteAdapterScript(script?: string) {
  return String(script || "").replace(/\r\n?/g, "\n").trim();
}
