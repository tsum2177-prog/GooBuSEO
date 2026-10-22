import type Stripe from "stripe";
import { hasActiveConnection } from "@/lib/google/connections";
import { createAdminClient } from "@/lib/supabase/admin";

export type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

/**
 * 課金機能が使える状態。
 *
 * `past_due` はStripeが支払いを再回収している状態です。Stripe側で
 * `canceled` に更新されるまでは猶予として扱います
 * （契約済みの店舗が決済エラーになった途端に機能を止めるのは避けるため）。
 */
const ACCESSIBLE_STATUSES: SubscriptionStatus[] = ["active", "past_due"];

/**
 * 未契約の無料枠で処理できる店舗数。
 *
 * レビュー取得はGBP APIのクォータを消費し、自動返信はAIコストと
 * 誤投稿リスクに直結するため、契約していない間は1店舗に絞ります。
 */
export const FREE_MAX_LOCATIONS = 1;

/**
 * ユーザーが使える機能の範囲。
 *
 * Googleマップの連携があれば、レビュー確認とAI返信の作成（下書き）までは
 * 無料で使えます。Googleマップへの投稿と自動返信は契約後のみです。
 */
export type AccessLevel = {
  /** レビューの取得・閲覧 */
  canReadReviews: boolean;
  /** AI返信の作成（下書き） */
  canGenerateReplies: boolean;
  /** Googleマップへの投稿 */
  canPostReplies: boolean;
  /** 定期実行による自動投稿 */
  canAutoReply: boolean;
  /** 処理できる店舗数の上限 */
  maxLocations: number;
};

export const SUBSCRIPTION_REQUIRED_MESSAGE =
  "投稿と自動返信には月額プランのご契約が必要です。ダッシュボードの「月額プランを契約する」から契約できます。";

export const GOOGLE_CONNECTION_REQUIRED_MESSAGE =
  "Googleマップがまだ連携されていません。先に連携してください。";

export function parseSubscriptionStatus(
  value: unknown
): SubscriptionStatus {
  return value === "active" || value === "past_due" || value === "canceled"
    ? value
    : "none";
}

/**
 * 契約状態から、課金機能を使えるかどうかを判定します。
 */
export function isAccessibleStatus(status: SubscriptionStatus): boolean {
  return ACCESSIBLE_STATUSES.includes(status);
}

/**
 * ユーザーの契約状態を取得します。
 *
 * 取得に失敗した場合は「未契約」として扱います。
 * 課金の判定はfail-closed（契約状態不明なら使用不可）が安全だからです。
 */
export async function getSubscriptionStatus(
  userId: string
): Promise<SubscriptionStatus> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("subscription_status")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("契約状態を読み取れませんでした", error);
      return "none";
    }

    return parseSubscriptionStatus(data?.subscription_status);
  } catch (error) {
    console.error("契約状態を読み取れませんでした", error);
    return "none";
  }
}

/**
 * Stripeのサブスクリプション状態を、アプリの契約状態にマッピングします。
 */
export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      // 回収が継続している状態なので、猶予としてアクセスを許します
      return "past_due";
    case "paused":
      // 回収停止中。契約は継続しているので past_due と同じ扱いにします
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      // "incomplete" は初回支払いが完了していない状態で、契約は成立していません
      return "none";
  }
}

/**
 * 課金機能（レビュー取得・AI返信生成・返信投稿）を使えるかどうかを判定します。
 */
export async function isSubscribed(userId: string): Promise<boolean> {
  return isAccessibleStatus(await getSubscriptionStatus(userId));
}

/**
 * ユーザーが使える機能の範囲を判定します。
 *
 * 契約済みの場合はすべて使えます。契約していない場合は、Googleマップの
 * 連携があればレビュー確認とAI返信の作成（下書き）まで使えます。
 */
export async function getAccessLevel(userId: string): Promise<AccessLevel> {
  if (await isSubscribed(userId)) {
    return {
      canReadReviews: true,
      canGenerateReplies: true,
      canPostReplies: true,
      canAutoReply: true,
      maxLocations: Number.POSITIVE_INFINITY,
    };
  }

  const connected = await hasActiveConnection(userId);
  return {
    canReadReviews: connected,
    canGenerateReplies: connected,
    canPostReplies: false,
    canAutoReply: false,
    maxLocations: FREE_MAX_LOCATIONS,
  };
}
