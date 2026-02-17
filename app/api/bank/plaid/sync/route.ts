import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/server/prisma";
import { decryptString } from "../../../../../lib/server/crypto";
import { getPlaidClient } from "../../../../../lib/server/plaid";

const BodySchema = z.object({
  connectionId: z.string().min(1).optional(),
});

function parsePlaidDate(date: string): Date {
  // Plaid uses YYYY-MM-DD. Store as UTC midnight.
  return new Date(`${date}T00:00:00.000Z`);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const where = {
    userId,
    provider: "plaid" as const,
    ...(body.data.connectionId ? { id: body.data.connectionId } : {}),
  };

  try {
    const connections = await prisma.bankConnection.findMany({ where });
    const plaid = getPlaidClient();

    let accountsUpserted = 0;
    let transactionsUpserted = 0;

    for (const connection of connections) {
      const accessToken = decryptString(connection.accessTokenEnc);

      // Accounts
      const accountsRes = await plaid.accountsGet({ access_token: accessToken });

      for (const acct of accountsRes.data.accounts) {
        await prisma.bankAccount.upsert({
          where: {
            connectionId_providerAccountId: {
              connectionId: connection.id,
              providerAccountId: acct.account_id,
            },
          },
          update: {
            userId,
            name: acct.name,
            mask: acct.mask ?? null,
            type: acct.type ?? null,
            subtype: acct.subtype ?? null,
            currencyCode: acct.balances.iso_currency_code ?? null,
            currentBalance: acct.balances.current ?? null,
            availableBalance: acct.balances.available ?? null,
            lastBalanceAt: new Date(),
          },
          create: {
            userId,
            connectionId: connection.id,
            providerAccountId: acct.account_id,
            name: acct.name,
            mask: acct.mask ?? null,
            type: acct.type ?? null,
            subtype: acct.subtype ?? null,
            currencyCode: acct.balances.iso_currency_code ?? null,
            currentBalance: acct.balances.current ?? null,
            availableBalance: acct.balances.available ?? null,
            lastBalanceAt: new Date(),
          },
        });
        accountsUpserted++;
      }

      // Transactions (incremental)
      const cursorRow = await prisma.bankSyncCursor.upsert({
        where: { connectionId: connection.id },
        update: {},
        create: { userId, connectionId: connection.id },
      });

      let cursor = cursorRow.cursor ?? undefined;
      let hasMore = true;

      while (hasMore) {
        const sync = await plaid.transactionsSync({
          access_token: accessToken,
          cursor,
          count: 250,
        });

        for (const t of sync.data.added) {
          const account = await prisma.bankAccount.findUnique({
            where: {
              connectionId_providerAccountId: {
                connectionId: connection.id,
                providerAccountId: t.account_id,
              },
            },
          });

          if (!account) {
            // If we somehow got a tx for a missing account, skip until next sync.
            continue;
          }

          // Plaid: positive=spend, negative=income. Normalize to: positive=income, negative=spend
          const normalizedAmount = -t.amount;

          await prisma.bankTransaction.upsert({
            where: {
              accountId_providerTransactionId: {
                accountId: account.id,
                providerTransactionId: t.transaction_id,
              },
            },
            update: {
              userId,
              name: t.name,
              merchantName: t.merchant_name ?? null,
              amount: normalizedAmount,
              isoCurrencyCode: t.iso_currency_code ?? null,
              date: parsePlaidDate(t.date),
              pending: t.pending,
              category: t.personal_finance_category?.primary ?? null,
            },
            create: {
              userId,
              accountId: account.id,
              providerTransactionId: t.transaction_id,
              name: t.name,
              merchantName: t.merchant_name ?? null,
              amount: normalizedAmount,
              isoCurrencyCode: t.iso_currency_code ?? null,
              date: parsePlaidDate(t.date),
              pending: t.pending,
              category: t.personal_finance_category?.primary ?? null,
            },
          });
          transactionsUpserted++;
        }

        cursor = sync.data.next_cursor;
        hasMore = sync.data.has_more;
      }

      await prisma.bankSyncCursor.update({
        where: { connectionId: connection.id },
        data: { cursor: cursor ?? null, lastSyncAt: new Date() },
      });
    }

    return NextResponse.json({
      connections: connections.length,
      accountsUpserted,
      transactionsUpserted,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
