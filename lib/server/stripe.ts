import Stripe from "stripe";

declare global {
  // eslint-disable-next-line no-var
  var stripe: Stripe | undefined;
}

export function getStripe(): Stripe {
  if (typeof window !== "undefined") {
    throw new Error("getStripe() must only be called server-side");
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const stripe = global.stripe ?? new Stripe(key);

  if (process.env.NODE_ENV !== "production") {
    global.stripe = stripe;
  }

  return stripe;
}
