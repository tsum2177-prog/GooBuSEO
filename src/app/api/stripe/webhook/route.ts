import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

function mapSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripeが未設定です" },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "署名がありません" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await request.text();
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return NextResponse.json(
      { error: "署名の検証に失敗しました" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const userId = session.client_reference_id;
        const customerId = customerIdOf(session.customer);
        if (userId && customerId) {
          const row: Record<string, unknown> = {
            id: userId,
            stripe_customer_id: customerId,
          };
          if (session.customer_details?.email) {
            row.email = session.customer_details.email;
          }
          await admin.from("profiles").upsert(row, { onConflict: "id" });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = customerIdOf(subscription.customer);
        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : mapSubscriptionStatus(subscription.status);
        const patch: Record<string, unknown> = {
          subscription_status: status,
          stripe_price_id: subscription.items.data[0]?.price.id ?? null,
        };
        if (customerId) patch.stripe_customer_id = customerId;

        const userId = subscription.metadata.user_id;
        if (userId) {
          await admin
            .from("profiles")
            .upsert({ id: userId, ...patch }, { onConflict: "id" });
        } else if (customerId) {
          await admin
            .from("profiles")
            .update(patch)
            .eq("stripe_customer_id", customerId);
        }
        break;
      }
    }
  } catch {
    return NextResponse.json({ error: "処理エラー" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
