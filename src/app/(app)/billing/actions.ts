"use server";

import { redirect } from "next/navigation";
import { getAppUrl } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function createCheckoutSession() {
  const { supabase, user } = await requireUser();
  if (!isStripeConfigured()) redirect("/dashboard?checkout=error");

  const stripe = getStripe();
  if (!stripe) redirect("/dashboard?checkout=error");

  let checkoutUrl: string | null = null;
  let portalUrl: string | null = null;

  try {
    // APP_URL が未設定でも、ほかの失敗と同じ経路でユーザーに伝わるようにする
    const origin = getAppUrl();
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const existing = await stripe.customers.search({
        query: `metadata['user_id']:'${user.id}'`,
        limit: 1,
      });
      customerId = existing.data[0]?.id ?? null;
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
    }

    // 既に契約中のサブスクリプションがあれば、二重契約を避けて管理画面へ送る。
    // 顧客IDがまだ profiles に反映されていない状態で二度押すと作成されてしまう。
    // past_due / trialing も請求上の契約なので含める（active だけだと
    // 支払いに失敗中のお客様が二重に契約できてしまう）。
    const existingSubscription = await stripe.subscriptions.list({
      customer: customerId,
      status: ["active", "trialing", "past_due"],
      limit: 1,
    });

    if (existingSubscription.data.length > 0) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/dashboard`,
      });
      portalUrl = portal.url;
    } else {
      const session = await stripe.checkout.sessions.create(
        {
          customer: customerId,
          mode: "subscription",
          line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
          client_reference_id: user.id,
          subscription_data: { metadata: { user_id: user.id } },
          success_url: `${origin}/dashboard?checkout=success`,
          cancel_url: `${origin}/dashboard?checkout=cancel`,
        },
        {
          // 同一ユーザーの二度押しが同じ Checkout Session を返すようにする
          idempotencyKey: `checkout:${user.id}:${customerId}`,
        }
      );
      checkoutUrl = session.url;
    }
  } catch {
    redirect("/dashboard?checkout=error");
  }

  if (portalUrl) redirect(portalUrl);
  if (!checkoutUrl) redirect("/dashboard?checkout=error");
  redirect(checkoutUrl);
}

export async function createPortalSession() {
  const { supabase, user } = await requireUser();
  if (!isStripeConfigured()) redirect("/dashboard?checkout=error");

  const stripe = getStripe();
  if (!stripe) redirect("/dashboard?checkout=error");

  let portalUrl: string | null = null;

  try {
    const origin = getAppUrl();
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.stripe_customer_id) {
      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${origin}/dashboard`,
      });
      portalUrl = session.url;
    }
  } catch {
    redirect("/dashboard?checkout=error");
  }

  if (!portalUrl) redirect("/dashboard?checkout=error");
  redirect(portalUrl);
}
