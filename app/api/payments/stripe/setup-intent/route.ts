import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/server/prisma";
import { getStripe } from "../../../../../lib/server/stripe";

const BodySchema = z
  .object({
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    postCode: z.string().min(1).optional(),
    town: z.string().min(1).optional(),
    country: z.string().min(1).optional(),
  })
  .optional();

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json(
      { error: "Missing STRIPE_SECRET_KEY. Add it to .env.local to enable Stripe card linking." },
      { status: 500 }
    );
  }

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  const details = body.success ? body.data : undefined;

  // Ensure User row exists (keyed by Clerk userId)
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
    select: { id: true, stripeCustomerId: true },
  });

  const stripe = getStripe();

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: details?.name,
      address: details
        ? {
            line1: details.address,
            postal_code: details.postCode,
            city: details.town,
            country: details.country,
          }
        : undefined,
      metadata: { clerkUserId: userId },
    });

    customerId = customer.id;
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
  });

  return NextResponse.json({
    customerId,
    clientSecret: setupIntent.client_secret,
  });
}
