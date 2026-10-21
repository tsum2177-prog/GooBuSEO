import Stripe from "stripe";

export function isStripeConfigured() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID
  );
}

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function fetchPriceLabel(): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe || !process.env.STRIPE_PRICE_ID) return null;

  try {
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (price.unit_amount == null) return null;
    const value =
      price.currency.toLowerCase() === "jpy"
        ? price.unit_amount
        : price.unit_amount / 100;
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(value);
  } catch {
    return null;
  }
}
