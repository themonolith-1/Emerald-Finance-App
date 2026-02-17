import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "../../../../lib/server/prisma";
import { buildDashboardSnapshotFromTransactions, buildZeroDashboardSnapshot } from "../../../../lib/finance/from-transactions";
import type { FinancePeriod } from "../../../../lib/finance";

const QuerySchema = z.object({
  period: z.enum(["1W", "1M", "3M", "1Y", "ALL"]).default("1M"),
});

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ period: url.searchParams.get("period") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const period = parsed.data.period as FinancePeriod;

  // Dashboard should be card-relative. If the user has no linked card, return a flat zero snapshot.
  const hasCardLinked =
    (await prisma.stripePaymentMethod.count({
      where: { userId },
    })) > 0;

  if (!hasCardLinked) {
    return NextResponse.json({ snapshot: buildZeroDashboardSnapshot(period) });
  }

  // Credit-card-only accounts (Plaid). This keeps the dashboard "card-relative".
  const creditAccounts = await prisma.bankAccount.findMany({
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
    select: {
      id: true,
      currentBalance: true,
      availableBalance: true,
      currencyCode: true,
    },
  });

  if (creditAccounts.length === 0) {
    return NextResponse.json({ snapshot: buildZeroDashboardSnapshot(period) });
  }

  // Fetch enough history to support the period + 30d comparisons
  const now = new Date();
  const maxDays = period === "ALL" ? 730 : period === "1Y" ? 365 : period === "3M" ? 120 : 90;
  const from = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId,
      accountId: { in: creditAccounts.map((a) => a.id) },
      date: { gte: from },
    },
    orderBy: { date: "desc" },
    take: 5000,
    select: {
      id: true,
      date: true,
      name: true,
      merchantName: true,
      amount: true,
      category: true,
    },
  });

  const hasData = creditAccounts.length > 0 || transactions.length > 0;
  if (!hasData) {
    return NextResponse.json({ snapshot: buildZeroDashboardSnapshot(period) });
  }

  const snapshot = buildDashboardSnapshotFromTransactions({
    period,
    accounts: creditAccounts,
    transactions: transactions.map((t: (typeof transactions)[number]) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      meta: t.merchantName,
      amount: t.amount,
      category: t.category,
    })),
    now,
  });

  return NextResponse.json({ snapshot });
}
