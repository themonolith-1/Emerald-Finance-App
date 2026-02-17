export function normalizeCurrencyCode(code?: string | null): string | undefined {
  const c = (code ?? "").trim().toUpperCase();
  // Basic sanity: ISO 4217 codes are typically 3 letters.
  if (!/^[A-Z]{3}$/.test(c)) return undefined;
  return c;
}

export function inferCurrencyCodeFromAccounts(
  accounts: Array<{ currencyCode?: string | null }>,
  fallback?: string
): string | undefined {
  const counts = new Map<string, number>();

  for (const a of accounts) {
    const code = normalizeCurrencyCode(a.currencyCode);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }

  const fb = normalizeCurrencyCode(fallback);
  return best ?? fb;
}
