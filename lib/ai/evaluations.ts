import type { DashboardSnapshot } from "../finance/types";

type SpendingSummary = {
  timeframe: string;
  income: number;
  spend: number;
  net: number;
  topCategories: Array<{ category: string; amount: number }>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pct(n: number) {
  return Math.round(n * 100);
}

export type FinanceEvaluation = {
  status: "ok" | "no_data";
  score: number | null; // 0..100
  summary: string;
  insights: Array<{ severity: "info" | "warn" | "risk"; title: string; detail: string }>;
  nextActions: Array<{ label: string; route: string }>;
  metrics: {
    monthlySpend: number;
    monthlySpendTrendPct: number;
    currentBalance: number;
    currentBalanceTrendPct: number;
    savingsRate: number;
    upcomingBillsEstimate: number;
    categoryConcentrationTop1Pct: number | null;
  };
};

export function buildFinanceEvaluation(args: {
  snapshot: DashboardSnapshot;
  spendingSummary?: SpendingSummary;
}) : FinanceEvaluation {
  const s = args.snapshot;

  const hasAnyTx = (s.recentTransactions?.length ?? 0) > 0;
  const hasAnySeries = (s.points?.some((n) => n !== 0) ?? false) ||
    (s.series?.total?.some((n) => n !== 0) ?? false);
  const hasAnyKpiSignal =
    s.kpis.currentBalance !== 0 ||
    s.kpis.monthlySpend !== 0 ||
    s.kpis.savingsRate !== 0;

  const noData = !hasAnyTx && !hasAnySeries && !hasAnyKpiSignal;
  if (noData) {
    return {
      status: "no_data",
      score: null,
      summary: "No finance data yet. Link a card and connect a bank account to see spending, trends, and insights.",
      insights: [
        {
          severity: "info",
          title: "Connect your accounts",
          detail: "Go to /banking to link a card (Stripe) and connect transaction history (Plaid).",
        },
      ],
      nextActions: [
        { label: "Connect a card and bank", route: "/banking" },
        { label: "View dashboard", route: "/dashboard" },
      ],
      metrics: {
        monthlySpend: 0,
        monthlySpendTrendPct: 0,
        currentBalance: 0,
        currentBalanceTrendPct: 0,
        savingsRate: 0,
        upcomingBillsEstimate: 0,
        categoryConcentrationTop1Pct: null,
      },
    };
  }

  const monthlySpend = s.kpis.monthlySpend;
  const savingsRate = s.kpis.savingsRate;
  const spendTrend = s.kpis.monthlySpendTrendPct;
  const balanceTrend = s.kpis.currentBalanceTrendPct;

  // Category concentration (top category share of spending)
  let top1Share: number | null = null;
  if (args.spendingSummary && args.spendingSummary.spend > 0 && args.spendingSummary.topCategories.length > 0) {
    const top1 = args.spendingSummary.topCategories[0];
    top1Share = clamp(top1.amount / args.spendingSummary.spend, 0, 1);
  }

  // Simple score heuristic (0..100)
  // - Savings rate contributes strongly
  // - Rapidly increasing spend is penalized
  // - Highly concentrated spending is mildly penalized
  let score = 50;
  score += clamp((savingsRate - 0.2) * 120, -30, 40); // target ~20%+ savings
  score += clamp((-spendTrend) * 25, -15, 15); // if spend trend is up, subtract
  score += clamp((balanceTrend) * 20, -10, 10);
  if (top1Share != null) score -= clamp((top1Share - 0.35) * 40, 0, 12);
  score = Math.round(clamp(score, 0, 100));

  const insights: FinanceEvaluation["insights"] = [];

  if (savingsRate === 0 && args.spendingSummary?.income === 0 && args.spendingSummary?.spend > 0) {
    insights.push({
      severity: "warn",
      title: "Income not detected",
      detail: "Your connected data shows spending but no income in this timeframe. If you only connected credit accounts, income may not appear.",
    });
  }

  if (spendTrend > 0.15) {
    insights.push({
      severity: "risk",
      title: "Spending is trending up",
      detail: `Spending is up about ${pct(spendTrend)}% vs the previous period. Consider reviewing top categories and recurring charges.`,
    });
  } else if (spendTrend < -0.15) {
    insights.push({
      severity: "info",
      title: "Spending is trending down",
      detail: `Nice — spending is down about ${pct(-spendTrend)}% vs the previous period.`,
    });
  }

  if (s.kpis.upcomingBills > 0) {
    insights.push({
      severity: "info",
      title: "Upcoming bills estimate",
      detail: `Estimated upcoming bills: ${Math.round(s.kpis.upcomingBills)} due in ~${s.kpis.upcomingBillsDueInDays} days.`,
    });
  }

  if (top1Share != null && top1Share > 0.5) {
    const top1 = args.spendingSummary!.topCategories[0];
    insights.push({
      severity: "warn",
      title: "Spending is concentrated",
      detail: `Top category (${top1.category}) is ~${pct(top1Share)}% of spend in this timeframe.`,
    });
  }

  const summaryParts: string[] = [];
  summaryParts.push(`Health score: ${score}/100.`);
  summaryParts.push(`Monthly spend: ${Math.round(monthlySpend)}.`);
  summaryParts.push(`Savings rate: ${pct(savingsRate)}%.`);
  if (top1Share != null) summaryParts.push(`Top category share: ${pct(top1Share)}%.`);

  return {
    status: "ok",
    score,
    summary: summaryParts.join(" "),
    insights,
    nextActions: [
      { label: "View dashboard", route: "/dashboard" },
      { label: "Manage connections", route: "/banking" },
    ],
    metrics: {
      monthlySpend,
      monthlySpendTrendPct: spendTrend,
      currentBalance: s.kpis.currentBalance,
      currentBalanceTrendPct: balanceTrend,
      savingsRate,
      upcomingBillsEstimate: s.kpis.upcomingBills,
      categoryConcentrationTop1Pct: top1Share,
    },
  };
}
