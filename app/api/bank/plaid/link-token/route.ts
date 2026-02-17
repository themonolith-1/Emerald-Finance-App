import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { CountryCode, Products } from "plaid";
import { getPlaidClient } from "../../../../../lib/server/plaid";
import { getServerEnv } from "../../../../../lib/server/env";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const env = getServerEnv();
    const plaid = getPlaidClient();

    const result = await plaid.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "Emerald",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: env.PLAID_REDIRECT_URI,
      webhook: env.PLAID_WEBHOOK_URL,
    });

    return NextResponse.json({ link_token: result.data.link_token });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create link token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
