import type { DashboardSnapshot, DemoTransaction, FinancePeriod, SpendingCategory, SpendingSeries } from "./types";
import { inferCurrencyCodeFromAccounts } from "./currency";

type TxLike = {
  id: string;
  date: Date;
  name: string;
  meta?: string | null;
  amount: number; // positive=income, negative=expense
  category?: string | null;
};

type AccountLike = {
  currentBalance?: number | null;
  availableBalance?: number | null;
  currencyCode?: string | null;
};

type BucketConfig = { len: number; labelStyle: "dow" | "week" | "month" | "point"; windowDays: number };

function getBucketConfig(period: FinancePeriod): BucketConfig {
  switch (period) {
    case "1W":
      return { len: 7, labelStyle: "dow", windowDays: 7 };
    case "1M":
      // match demo UI density
      return { len: 12, labelStyle: "week", windowDays: 30 };
    case "3M":
      return { len: 18, labelStyle: "week", windowDays: 90 };
    case "1Y":
      return { len: 12, labelStyle: "month", windowDays: 365 };
    case "ALL":
      return { len: 22, labelStyle: "point", windowDays: 730 };
  }
}

function getLabels(period: FinancePeriod, len: number): string[] {
  if (period === "1W") {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.slice(0, len);
  }
  if (period === "1M" || period === "3M") {
    return Array.from({ length: len }, (_, i) => `W${i + 1}`);
  }
  if (period === "1Y") {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months.slice(0, len);
  }
  return Array.from({ length: len }, (_, i) => `P${i + 1}`);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mapCategory(raw?: string | null): SpendingCategory {
  const s = (raw ?? "").toUpperCase();
  if (s.includes("SUBSCRIPT") || s.includes("SERVICE") || s.includes("STREAM")) return "Subscriptions";
  if (s.includes("ENTERTAIN") || s.includes("TRAVEL") || s.includes("TRANSPORT") || s.includes("RECREATION")) return "Leisure";
  return "Essentials";
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0);
}

function sumRange(transactions: TxLike[], start: Date, end: Date) {
  let income = 0;
  let spend = 0;
  for (const t of transactions) {
    if (t.date < start || t.date >= end) continue;
    if (t.amount >= 0) income += t.amount;
    else spend += -t.amount;
  }
  return { income, spend };
}

export function buildZeroDashboardSnapshot(period: FinancePeriod): DashboardSnapshot {
  const cfg = getBucketConfig(period);
  const labels = getLabels(period, cfg.len);

  const zerosTotal = Array(cfg.len).fill(0) as number[];
  const zerosEssentials = Array(cfg.len).fill(0) as number[];
  const zerosLeisure = Array(cfg.len).fill(0) as number[];
  const zerosSubscriptions = Array(cfg.len).fill(0) as number[];

  const series: SpendingSeries = {
    total: zerosTotal,
    essentials: zerosEssentials,
    leisure: zerosLeisure,
    subscriptions: zerosSubscriptions,
  };

  return {
    period,
    currencyCode: undefined,
    labels,
    series,
    points: series.total,
    kpis: {
      currentBalance: 0,
      currentBalanceTrendPct: 0,

      monthlySpend: 0,
      monthlySpendTrendPct: 0,

      savingsRate: 0,
      savingsRateTrendPctPoints: 0,

      upcomingBills: 0,
      upcomingBillsDueInDays: 0,
    },
    recentTransactions: [],
  };
}

export function buildDashboardSnapshotFromTransactions(args: {
  period: FinancePeriod;
  accounts: AccountLike[];
  transactions: TxLike[];
  now?: Date;
}): DashboardSnapshot {
  const now = args.now ?? new Date();
  const cfg = getBucketConfig(args.period);
  const labels = getLabels(args.period, cfg.len);

  const endMs = now.getTime();
  const startMs = endMs - cfg.windowDays * 24 * 60 * 60 * 1000;
  const segmentMs = (endMs - startMs) / cfg.len;

  const total = Array(cfg.len).fill(0) as number[];
  const essentials = Array(cfg.len).fill(0) as number[];
  const leisure = Array(cfg.len).fill(0) as number[];
  const subscriptions = Array(cfg.len).fill(0) as number[];

  for (const t of args.transactions) {
    if (t.amount >= 0) continue; // only spending for the chart

    const ts = t.date.getTime();
    if (ts < startMs || ts >= endMs) continue;

    const idx = clamp(Math.floor((ts - startMs) / segmentMs), 0, cfg.len - 1);
    const spendValue = -t.amount;

    total[idx] += spendValue;
    const cat = mapCategory(t.category);
    if (cat === "Essentials") essentials[idx] += spendValue;
    else if (cat === "Leisure") leisure[idx] += spendValue;
    else subscriptions[idx] += spendValue;
  }

  const series: SpendingSeries = {
    total: total.map((n) => Math.round(n)),
    essentials: essentials.map((n) => Math.round(n)),
    leisure: leisure.map((n) => Math.round(n)),
    subscriptions: subscriptions.map((n) => Math.round(n)),
  };

  const points = series.total;

  const currencyCode = inferCurrencyCodeFromAccounts(args.accounts);

  const currentBalance = args.accounts.reduce((acc, a) => acc + (a.currentBalance ?? 0), 0);

  // KPI windows
  const d30 = 30 * 24 * 60 * 60 * 1000;
  const end = now;
  const start30 = new Date(end.getTime() - d30);
  const start60 = new Date(end.getTime() - 2 * d30);

  const this30 = sumRange(args.transactions, start30, end);
  const prev30 = sumRange(args.transactions, start60, start30);

  const monthlySpend = this30.spend;
  const monthlySpendTrendPct = prev30.spend === 0 ? 0 : (this30.spend - prev30.spend) / prev30.spend;

  const savingsRate = this30.income === 0 ? 0 : clamp((this30.income - this30.spend) / this30.income, 0, 0.95);
  const prevSavingsRate = prev30.income === 0 ? 0 : clamp((prev30.income - prev30.spend) / prev30.income, 0, 0.95);
  const savingsRateTrendPctPoints = (savingsRate - prevSavingsRate) * 100;

  // Balance trend: approximate via 7-day net delta
  const d7 = 7 * 24 * 60 * 60 * 1000;
  const net7 = args.transactions
    .filter((t) => t.date.getTime() >= end.getTime() - d7)
    .reduce((acc, t) => acc + t.amount, 0);
  const priorBalance = currentBalance - net7;
  const currentBalanceTrendPct = priorBalance === 0 ? 0 : (currentBalance - priorBalance) / Math.abs(priorBalance);

  const upcomingBills = sum(series.subscriptions) / 2; // rough: half-period subscription burn
  const upcomingBillsDueInDays = 7;

  const recentTransactions: DemoTransaction[] = [...args.transactions]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6)
    .map((t) => ({
      id: t.id,
      dateISO: t.date.toISOString(),
      name: t.name,
      meta: t.meta ?? t.category ?? "Bank",
      amount: t.amount,
      category: t.amount < 0 ? mapCategory(t.category) : undefined,
    }))
    .slice(0, 4);

  return {
    period: args.period,
    currencyCode,
    labels,
    series,
    points,
    kpis: {
      currentBalance,
      currentBalanceTrendPct: clamp(currentBalanceTrendPct, -0.5, 0.5),
      monthlySpend,
      monthlySpendTrendPct: clamp(monthlySpendTrendPct, -0.9, 0.9),
      savingsRate,
      savingsRateTrendPctPoints: clamp(savingsRateTrendPctPoints, -50, 50),
      upcomingBills,
      upcomingBillsDueInDays,
    },
    recentTransactions,
  };
}
