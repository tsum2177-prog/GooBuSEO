import Stripe from "stripe";

export function isStripeConfigured() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID
  );
}

/**
 * クライアントの生成にはコストがかかるので、呼び出しをまたいで使い回します。
 * キーが変わったときだけ作り直します。
 */
let stripeClient: Stripe | null = null;
let stripeClientKey: string | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;

  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key);
    stripeClientKey = key;
  }

  return stripeClient;
}

/** 価格ラベルは頻繁に変わらないので、この時間だけ使い回します。 */
const PRICE_LABEL_TTL_MS = 60 * 60 * 1000;

let cachedPriceLabel: string | null = null;
let cachedPriceLabelAt = 0;

/**
 * 月額プランの価格ラベルを取得します。
 *
 * ランディングページが全リクエストで呼ばないよう、TTL内はキャッシュを使います。
 * 失敗時の null はキャッシュしないので、一時的なエラーが1時間も残りません。
 */
export async function fetchPriceLabel(): Promise<string | null> {
  const now = Date.now();
  if (cachedPriceLabel !== null && now - cachedPriceLabelAt < PRICE_LABEL_TTL_MS) {
    return cachedPriceLabel;
  }

  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!stripe || !priceId) return null;

  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount == null) return null;
    const value =
      price.currency.toLowerCase() === "jpy"
        ? price.unit_amount
        : price.unit_amount / 100;
    const label = new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(value);

    cachedPriceLabel = label;
    cachedPriceLabelAt = now;
    return label;
  } catch (error) {
    console.error("Stripeの価格ラベルを読み取れませんでした", error);
    return null;
  }
}
