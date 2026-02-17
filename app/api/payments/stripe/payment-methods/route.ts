import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/server/prisma";
import { getStripe } from "../../../../../lib/server/stripe";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const methods = await prisma.stripePaymentMethod.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stripePaymentMethodId: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ paymentMethods: methods });
}

const SaveSchema = z.object({
  paymentMethodId: z.string().min(1),
  setDefault: z.boolean().optional(),
});

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

  const body = SaveSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

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
      metadata: { clerkUserId: userId },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  const pm = await stripe.paymentMethods.retrieve(body.data.paymentMethodId);
  if (pm.type !== "card") {
    return NextResponse.json({ error: "Only card payment methods are supported." }, { status: 400 });
  }

  // Security checks: payment method must either be unattached or attached to this user's customer.
  const attachedCustomerId = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (attachedCustomerId && attachedCustomerId !== customerId) {
    return NextResponse.json({ error: "Payment method belongs to a different customer." }, { status: 403 });
  }

  if (!attachedCustomerId) {
    await stripe.paymentMethods.attach(pm.id, { customer: customerId });
  }

  if (body.data.setDefault) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pm.id },
    });
  }

  const card = pm.card;
  const saved = await prisma.stripePaymentMethod.upsert({
    where: {
      userId_stripePaymentMethodId: {
        userId,
        stripePaymentMethodId: pm.id,
      },
    },
    update: {
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
    },
    create: {
      userId,
      stripePaymentMethodId: pm.id,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
    },
    select: {
      id: true,
      stripePaymentMethodId: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ paymentMethod: saved });
}

const DeleteSchema = z.object({
  paymentMethodId: z.string().min(1),
});

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json(
      { error: "Missing STRIPE_SECRET_KEY. Add it to .env.local to enable Stripe card unlinking." },
      { status: 500 }
    );
  }

  const body = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  const stripe = getStripe();

  // If it is attached to the user's customer, detach it.
  const pm = await stripe.paymentMethods.retrieve(body.data.paymentMethodId);
  const attachedCustomerId = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;

  if (user?.stripeCustomerId && attachedCustomerId === user.stripeCustomerId) {
    await stripe.paymentMethods.detach(body.data.paymentMethodId);
  }

  await prisma.stripePaymentMethod.deleteMany({
    where: { userId, stripePaymentMethodId: body.data.paymentMethodId },
  });

  return NextResponse.json({ ok: true });
}
