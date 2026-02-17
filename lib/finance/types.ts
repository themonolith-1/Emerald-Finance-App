export type FinancePeriod = "1W" | "1M" | "3M" | "1Y" | "ALL";

export type SpendingCategory = "Essentials" | "Leisure" | "Subscriptions";

export type SpendingSeries = {
  total: number[];
  essentials: number[];
  leisure: number[];
  subscriptions: number[];
};

export type DemoTransaction = {
  id: string;
  dateISO: string;
  name: string;
  meta: string;
  amount: number; // positive = income, negative = expense
  category?: SpendingCategory;
};

export type DashboardKpis = {
  currentBalance: number;
  currentBalanceTrendPct: number;

  monthlySpend: number;
  monthlySpendTrendPct: number;

  savingsRate: number; // 0..1
  savingsRateTrendPctPoints: number; // percentage points delta, e.g. +1.3 = +1.3pp

  upcomingBills: number;
  upcomingBillsDueInDays: number;
};

export type DashboardSnapshot = {
  period: FinancePeriod;
  currencyCode?: string;
  labels: string[];
  series: SpendingSeries;
  points: number[]; // spending total (same scale as series.total)
  kpis: DashboardKpis;
  recentTransactions: DemoTransaction[];
};
