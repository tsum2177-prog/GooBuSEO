import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { mapStripeSubscriptionStatus } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * 削除済みユーザー向けのイベントかどうか。
 * これは再送しても直らないので、500を返して無限リトライにせず処理を打ち切ります。
 */
function isMissingUser(error: { code?: string; details?: string } | null) {
  return Boolean(error?.code === "23503" || error?.details?.includes("auth.users"));
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

  // Stripe は一度以上送信してくるため、同一イベントは一度だけ処理する
  const { data: recorded, error: recordError } = await admin
    .from("stripe_events")
    .upsert({ id: event.id }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");

  if (recordError) {
    // 記録できない環境では重複を握りつぶして処理を続行する
    console.error("[stripe] failed to record the event", recordError);
  } else if (!recorded || recorded.length === 0) {
    console.warn("[stripe] skipping a duplicate event", { id: event.id });
    return NextResponse.json({ received: true, duplicate: true });
  }

  // 遅れて届いた古いイベントで、新しい状態を上書きしないための時刻
  const eventAt = event.created
    ? new Date(event.created * 1000).toISOString()
    : new Date().toISOString();

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
          // 支払いが完了していれば、この時点で契約状態を更新しておく。
          // subscription イベントが遅れても「未契約」のままにならないようにするため。
          if (session.payment_status === "paid") {
            row.subscription_status = "active";
          }
          const { error } = await admin
            .from("profiles")
            .upsert(row, { onConflict: "id" });

          if (isMissingUser(error)) {
            console.warn("[stripe] skipping an event for a deleted user", {
              event: event.type,
              error,
            });
            return NextResponse.json({ received: true, skipped: true });
          }
          if (error) throw error;
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
            : mapStripeSubscriptionStatus(subscription.status);

        const patch: Record<string, unknown> = {
          subscription_status: status,
          stripe_price_id: subscription.items.data[0]?.price.id ?? null,
          stripe_event_created_at: eventAt,
        };
        if (customerId) patch.stripe_customer_id = customerId;

        const userId = subscription.metadata.user_id;
        if (userId) {
          if (await isStaleEvent(admin, userId, event.created)) {
            console.warn("[stripe] skipping an out-of-order event", {
              event: event.type,
              userId,
              eventAt,
            });
            break;
          }

          const { error } = await admin
            .from("profiles")
            .upsert({ id: userId, ...patch }, { onConflict: "id" });

          if (isMissingUser(error)) {
            console.warn("[stripe] skipping an event for a deleted user", {
              event: event.type,
              error,
            });
            return NextResponse.json({ received: true, skipped: true });
          }
          if (error) throw error;

          // 契約が成立したら自動返信をONにする。
          // 設定画面を触らずに、自动投稿まで最短で到達できるようにするため。
          if (status === "active") {
            await enableAutoReply(admin, userId);
          }
        } else if (customerId) {
          const { error, count } = await admin
            .from("profiles")
            .update(patch)
            .eq("stripe_customer_id", customerId);

          if (error) throw error;
          if (count === 0) {
            console.warn(
              "[stripe] no profile matched the customer",
              { customerId, event: event.type }
            );
          }
        }
        break;
      }
    }
  } catch (error) {
    // 一時的な失敗は 500 を返して Stripe に再送させる
    console.error("[stripe] handler failed", { event: event.type, error });
    return NextResponse.json({ error: "処理エラー" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * 契約が成立したユーザーの自動返信をONにします。
 *
 * 設定画面を開かずに自動投稿まで到達できるようにするためです。
 * 店舗設定の行が無い場合は、自動返信だけ有効にした行を作ります
 * （店舗名や業種はGoogle連携時に自動投入されます）。
 */
async function enableAutoReply(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<void> {
  const { data, error } = await admin
    .from("shop_settings")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[stripe] failed to read shop settings", error);
    return;
  }

  if (!data) {
    const { error: insertError } = await admin
      .from("shop_settings")
      .upsert({ id: userId, auto_reply_enabled: true }, { onConflict: "id" });
    if (insertError) {
      console.error("[stripe] failed to enable auto reply", insertError);
    }
    return;
  }

  const { error: updateError } = await admin
    .from("shop_settings")
    .update({ auto_reply_enabled: true })
    .eq("id", userId);
  if (updateError) {
    console.error("[stripe] failed to enable auto reply", updateError);
  }
}

/**
 * より古いイベントが遅れて届いたかどうかを判定します。
 * Stripe は順序を保証しないので、古い `subscription.updated` が
 * 新しい `subscription.deleted` を上書きしないように使います。
 */
async function isStaleEvent(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  eventCreated?: number
): Promise<boolean> {
  if (!eventCreated) return false;

  const { data, error } = await admin
    .from("profiles")
    .select("stripe_event_created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[stripe] failed to read the last event time", error);
    return false;
  }

  const previous = data?.stripe_event_created_at
    ? new Date(data.stripe_event_created_at).getTime()
    : 0;

  return previous > eventCreated * 1000;
}
