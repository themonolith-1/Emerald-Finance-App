import { prisma } from "../server/prisma";
import { buildDashboardSnapshotFromTransactions, buildZeroDashboardSnapshot } from "../finance/from-transactions";
import type { FinancePeriod } from "../finance";
import { z } from "zod";

export const TimeframeSchema = z.enum([
  "PAST_7_DAYS",
  "PAST_30_DAYS",
  "PAST_90_DAYS",
  "THIS_MONTH",
  "LAST_MONTH",
  "ALL_TIME",
]);

export async function hasStripeCardLinked(userId: string): Promise<boolean> {
  return (
    (await prisma.stripePaymentMethod.count({
      where: { userId },
    })) > 0
  );
}

export async function getCreditAccountIdsForUser(userId: string): Promise<string[]> {
  const rows = await prisma.bankAccount.findMany({
    where: {
      userId,
      OR: [
        { type: { in: ["credit", "Credit", "CREDIT"] } },
        { subtype: { in: ["credit", "Credit", "CREDIT"] } },
        { subtype: { contains: "credit" } },
        { subtype: { contains: "Credit" } },
        { subtype: { contains: "card" } },
        { subtype: { contains: "Card" } },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export function getDateRangeForTimeframe(timeframe: z.infer<typeof TimeframeSchema>) {
  const now = new Date();

  if (timeframe === "ALL_TIME") {
    return { from: null as Date | null, to: now };
  }

  if (timeframe === "THIS_MONTH") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now };
  }

  if (timeframe === "LAST_MONTH") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from, to };
  }

  const days = timeframe === "PAST_7_DAYS" ? 7 : timeframe === "PAST_90_DAYS" ? 90 : 30;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to: now };
}

export async function getFinanceSnapshotForUser(userId: string, period: FinancePeriod) {
  if (!(await hasStripeCardLinked(userId))) {
    return { snapshot: buildZeroDashboardSnapshot(period) } as const;
  }

  const creditAccountIds = await getCreditAccountIdsForUser(userId);
  if (creditAccountIds.length === 0) {
    return { snapshot: buildZeroDashboardSnapshot(period) } as const;
  }

  const accounts = await prisma.bankAccount.findMany({
    where: { userId, id: { in: creditAccountIds } },
    select: { currentBalance: true, availableBalance: true, currencyCode: true },
  });

  const now = new Date();
  const maxDays = period === "ALL" ? 730 : period === "1Y" ? 365 : period === "3M" ? 120 : 90;
  const from = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);

  const transactions = await prisma.bankTransaction.findMany({
    where: { userId, accountId: { in: creditAccountIds }, date: { gte: from } },
    orderBy: { date: "desc" },
    take: 5000,
    select: { id: true, date: true, name: true, merchantName: true, amount: true, category: true },
  });

  const hasData = accounts.length > 0 || transactions.length > 0;
  if (!hasData) {
    return { snapshot: buildZeroDashboardSnapshot(period) } as const;
  }

  const snapshot = buildDashboardSnapshotFromTransactions({
    period,
    accounts,
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      meta: t.merchantName,
      amount: t.amount,
      category: t.category,
    })),
    now,
  });

  return { snapshot } as const;
}

export async function getRecentTransactionsForUser(userId: string, params: { limit: number; timeframe: z.infer<typeof TimeframeSchema> }) {
  if (!(await hasStripeCardLinked(userId))) {
    return { timeframe: params.timeframe, count: 0, transactions: [] };
  }

  const creditAccountIds = await getCreditAccountIdsForUser(userId);
  if (creditAccountIds.length === 0) {
    return { timeframe: params.timeframe, count: 0, transactions: [] };
  }

  const { from, to } = getDateRangeForTimeframe(params.timeframe);

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId,
      accountId: { in: creditAccountIds },
      ...(from
        ? {
            date: {
              gte: from,
              lte: to,
            },
          }
        : {}),
    },
    orderBy: { date: "desc" },
    take: Math.min(Math.max(params.limit, 1), 100),
    select: { id: true, date: true, name: true, merchantName: true, amount: true, category: true },
  });

  return {
    timeframe: params.timeframe,
    count: transactions.length,
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      merchantName: t.merchantName,
      amount: t.amount,
      category: t.category,
    })),
  };
}

function buildSpendingSummary(transactions: Array<{ amount: number; category: string | null }>) {
  let income = 0;
  let spend = 0;

  const spendByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount >= 0) {
      income += t.amount;
      continue;
    }
    const spendValue = -t.amount;
    spend += spendValue;

    const category = (t.category ?? "Uncategorized").trim() || "Uncategorized";
    spendByCategory.set(category, (spendByCategory.get(category) ?? 0) + spendValue);
  }

  const topCategories = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([category, amount]) => ({ category, amount }));

  const net = income - spend;
  return { income, spend, net, topCategories };
}

export async function getSpendingSummaryForUser(userId: string, timeframe: z.infer<typeof TimeframeSchema>) {
  if (!(await hasStripeCardLinked(userId))) {
    return { timeframe, income: 0, spend: 0, net: 0, topCategories: [] };
  }

  const creditAccountIds = await getCreditAccountIdsForUser(userId);
  if (creditAccountIds.length === 0) {
    return { timeframe, income: 0, spend: 0, net: 0, topCategories: [] };
  }

  const { from, to } = getDateRangeForTimeframe(timeframe);
  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId,
      accountId: { in: creditAccountIds },
      ...(from
        ? {
            date: {
              gte: from,
              lte: to,
            },
          }
        : {}),
    },
    select: { amount: true, category: true },
  });

  return {
    timeframe,
    ...buildSpendingSummary(transactions),
  };
}
