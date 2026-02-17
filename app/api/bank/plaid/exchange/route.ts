import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getPlaidClient } from "../../../../../lib/server/plaid";
import { prisma } from "../../../../../lib/server/prisma";
import { encryptString } from "../../../../../lib/server/crypto";

const BodySchema = z.object({
  public_token: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const plaid = getPlaidClient();
    const exchange = await plaid.itemPublicTokenExchange({ public_token: body.data.public_token });

    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    // Ensure a User row exists (keyed by Clerk userId)
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const connection = await prisma.bankConnection.upsert({
      where: { providerItemId: itemId },
      update: {
        userId,
        provider: "plaid",
        accessTokenEnc: encryptString(accessToken),
      },
      create: {
        userId,
        provider: "plaid",
        providerItemId: itemId,
        accessTokenEnc: encryptString(accessToken),
      },
    });

    return NextResponse.json({ connectionId: connection.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to exchange token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
