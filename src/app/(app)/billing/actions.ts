"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

async function getOrigin() {
  const headerStore = await headers();
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  const host = headerStore.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

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

  const origin = await getOrigin();
  let checkoutUrl: string | null = null;

  try {
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancel`,
    });
    checkoutUrl = session.url;
  } catch {
    redirect("/dashboard?checkout=error");
  }

  if (!checkoutUrl) redirect("/dashboard?checkout=error");
  redirect(checkoutUrl);
}

export async function createPortalSession() {
  const { supabase, user } = await requireUser();
  if (!isStripeConfigured()) redirect("/dashboard?checkout=error");

  const stripe = getStripe();
  if (!stripe) redirect("/dashboard?checkout=error");

  const origin = await getOrigin();
  let portalUrl: string | null = null;

  try {
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
