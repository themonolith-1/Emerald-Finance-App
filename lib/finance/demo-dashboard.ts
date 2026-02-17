import { createRng } from "./rng";
import type {
  DashboardSnapshot,
  DemoTransaction,
  FinancePeriod,
  SpendingCategory,
  SpendingSeries,
} from "./types";

type BucketConfig = { len: number; labelStyle: "dow" | "week" | "month" | "point" };

function getBucketConfig(period: FinancePeriod): BucketConfig {
  switch (period) {
    case "1W":
      return { len: 7, labelStyle: "dow" };
    case "1M":
      // matches existing UI density
      return { len: 12, labelStyle: "week" };
    case "3M":
      return { len: 18, labelStyle: "week" };
    case "1Y":
      return { len: 12, labelStyle: "month" };
    case "ALL":
      return { len: 22, labelStyle: "point" };
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

function splitSpending(total: number, idx: number): { essentials: number; leisure: number; subscriptions: number } {
  // gentle oscillation so series look alive
  const essentialsRatio = clamp(0.56 + ((idx % 5) - 2) * 0.015, 0.45, 0.7);
  const leisureRatio = clamp(0.25 + ((idx % 3) - 1) * 0.02, 0.12, 0.35);
  const subscriptionsRatio = clamp(0.16 + ((idx % 4) - 1) * 0.01, 0.1, 0.25);

  // normalize
  const sum = essentialsRatio + leisureRatio + subscriptionsRatio;
  const e = Math.round(total * (essentialsRatio / sum));
  const l = Math.round(total * (leisureRatio / sum));
  const s = Math.max(0, total - e - l);
  return { essentials: e, leisure: l, subscriptions: s };
}

function buildSeries(period: FinancePeriod, seed: string) {
  const rng = createRng(seed);
  const { len } = getBucketConfig(period);

  // Scale the synthetic spend so it feels plausible for each period
  // (still demo; later these will come from bank/Stripe).
  const avgSpendByBucket =
    period === "1W" ? 420 :
    period === "1M" ? 780 :
    period === "3M" ? 720 :
    period === "1Y" ? 2100 :
    1600;

  const points: number[] = [];
  const essentials: number[] = [];
  const leisure: number[] = [];
  const subscriptions: number[] = [];

  for (let i = 0; i < len; i++) {
    const noise = rng.float(-0.22, 0.28);
    const seasonal = Math.sin((i / Math.max(1, len - 1)) * Math.PI * 1.8) * 0.08;
    const total = Math.round(avgSpendByBucket * (1 + noise + seasonal));
    const split = splitSpending(Math.max(120, total), i);
    points.push(split.essentials + split.leisure + split.subscriptions);
    essentials.push(split.essentials);
    leisure.push(split.leisure);
    subscriptions.push(split.subscriptions);
  }

  const series: SpendingSeries = {
    total: points,
    essentials,
    leisure,
    subscriptions,
  };

  return { points, series };
}

function computeKpis(period: FinancePeriod, seed: string) {
  const rng = createRng(`${seed}:kpis`);

  // Use 1M series for "Monthly Spend" so it stays meaningful even when chart period changes.
  const month = buildSeries("1M", `${seed}:month`);
  const prevMonth = buildSeries("1M", `${seed}:month-prev`);

  const monthlySpend = month.series.total.reduce((a, b) => a + b, 0);
  const prevMonthlySpend = prevMonth.series.total.reduce((a, b) => a + b, 0);
  const monthlySpendTrendPct = prevMonthlySpend === 0 ? 0 : (monthlySpend - prevMonthlySpend) / prevMonthlySpend;

  // Income: slightly higher than spend, varies per user
  const monthlyIncome = Math.round(monthlySpend * rng.float(1.12, 1.45));
  const prevMonthlyIncome = Math.round(prevMonthlySpend * rng.float(1.12, 1.45));

  const savingsRate = monthlyIncome === 0 ? 0 : clamp((monthlyIncome - monthlySpend) / monthlyIncome, 0, 0.9);
  const prevSavingsRate = prevMonthlyIncome === 0 ? 0 : clamp((prevMonthlyIncome - prevMonthlySpend) / prevMonthlyIncome, 0, 0.9);
  const savingsRateTrendPctPoints = (savingsRate - prevSavingsRate) * 100;

  const startingBalance = rng.int(5000, 24000) + rng.float(0, 0.99);
  const netMonthly = monthlyIncome - monthlySpend;
  const currentBalance = Math.max(0, startingBalance + netMonthly * rng.float(0.4, 1.2));

  // Balance trend: compare this period vs prior (approx)
  const currentBalanceTrendPct = clamp(rng.float(-0.015, 0.035), -0.2, 0.2);

  // Upcoming bills (subscriptions)
  const upcomingBillsDueInDays = rng.int(3, 10);
  const upcomingBills = rng.int(120, 920);

  return {
    currentBalance,
    currentBalanceTrendPct,
    monthlySpend,
    monthlySpendTrendPct,
    savingsRate,
    savingsRateTrendPctPoints,
    upcomingBills,
    upcomingBillsDueInDays,
  };
}

function buildRecentTransactions(seed: string): DemoTransaction[] {
  const rng = createRng(`${seed}:recent`);
  const merchants = [
    { name: "Groceries", meta: "Whole Foods", category: "Essentials" as const },
    { name: "Coffee", meta: "Blue Bottle", category: "Leisure" as const },
    { name: "Streaming", meta: "Netflix", category: "Subscriptions" as const },
    { name: "Ride", meta: "Uber", category: "Leisure" as const },
    { name: "Utilities", meta: "City Power", category: "Essentials" as const },
  ];

  const incomes = [
    { name: "Salary", meta: "Payroll", amount: rng.int(2800, 5200) },
    { name: "Refund", meta: "Merchant refund", amount: rng.int(20, 220) },
  ];

  const out: DemoTransaction[] = [];
  const now = Date.now();

  // Ensure a mix: 1 income + 3 expenses
  const income = rng.pick(incomes);
  out.push({
    id: `tx_${seed}_inc`,
    dateISO: new Date(now - rng.int(1, 4) * 24 * 3600 * 1000).toISOString(),
    name: income.name,
    meta: income.meta,
    amount: income.amount,
  });

  for (let i = 0; i < 3; i++) {
    const m = rng.pick(merchants);
    const amt = rng.int(6, 180) + rng.float(0, 0.99);
    out.push({
      id: `tx_${seed}_${i}`,
      dateISO: new Date(now - rng.int(1, 10) * 24 * 3600 * 1000).toISOString(),
      name: m.name,
      meta: m.meta,
      amount: -amt,
      category: m.category satisfies SpendingCategory,
    });
  }

  // sort desc by date
  out.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  return out.slice(0, 4);
}

export function getDemoDashboardSnapshot(period: FinancePeriod, seed: string): DashboardSnapshot {
  const config = getBucketConfig(period);
  const labels = getLabels(period, config.len);
  const { points, series } = buildSeries(period, `${seed}:series:${period}`);
  const kpis = computeKpis(period, seed);
  const recentTransactions = buildRecentTransactions(seed);

  return {
    period,
    labels,
    series,
    points,
    kpis,
    recentTransactions,
  };
}
