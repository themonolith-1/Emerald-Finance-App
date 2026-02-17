export function formatMoney(n: number, args?: { currencyCode?: string; decimals?: number }): string {
  const decimals = args?.decimals ?? 0;
  const currencyCode = (args?.currencyCode ?? "").trim().toUpperCase();
  const base: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };

  if (currencyCode && /^[A-Z]{3}$/.test(currencyCode)) {
    return n.toLocaleString(undefined, { ...base, style: "currency", currency: currencyCode });
  }

  // Unknown currency: fall back to a plain localized number (no '$' assumption).
  return n.toLocaleString(undefined, base);
}

// Backwards-compatible alias (previously always USD with '$').
export function formatCurrency(n: number, decimals = 0, currencyCode?: string): string {
  return formatMoney(n, { decimals, currencyCode });
}

export function formatSignedCurrency(n: number, decimals = 2): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(n), decimals)}`;
}

export function formatPct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

export function formatPctPoints(n: number, decimals = 1): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(decimals)}%`;
}
