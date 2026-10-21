import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SubscriptionNotice } from "@/components/billing/subscription-notice";
import { ReviewList, type ReviewItem } from "@/components/reviews/review-list";
import { isAccessibleStatus, parseSubscriptionStatus } from "@/lib/billing";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "レビュー履歴",
};

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const [{ data, error }, { data: profile }] = await Promise.all([
    supabase
      .from("reviews")
      .select(
        "id, author_name, rating, content, published_at, reply_text, replied_at, auto_replied, posted_via, created_at"
      )
      .eq("user_id", user.id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const reviews = (data ?? []) as ReviewItem[];
  const canReply = isAccessibleStatus(
    parseSubscriptionStatus(profile?.subscription_status)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">レビュー履歴</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Googleマップから取得したレビューと、送信済みの返信です。
        </p>
      </div>
      {!canReply && <SubscriptionNotice />}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          レビューを取得できませんでした。データベースの設定を確認してください。
        </p>
      ) : (
        <ReviewList reviews={reviews} canReply={canReply} />
      )}
    </div>
  );
}
