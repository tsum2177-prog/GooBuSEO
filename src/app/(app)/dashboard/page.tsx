import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanCard, type SubscriptionStatus } from "@/components/billing/plan-card";
import { StarRating } from "@/components/reviews/review-list";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

export const dynamic = "force-dynamic";

const checkoutMessages: Record<
  string,
  { text: string; className: string }
> = {
  success: {
    text: "お支払いが完了しました。反映まで少々お待ちください。",
    className:
      "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100",
  },
  cancel: {
    text: "決済はキャンセルされました。もう一度お試しください。",
    className: "border-border bg-muted text-foreground",
  },
  error: {
    text: "決済処理でエラーが発生しました。時間をおいて再度お試しください。",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

function parseStatus(value: unknown): SubscriptionStatus {
  return value === "active" || value === "past_due" || value === "canceled"
    ? value
    : "none";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: settings }, { data: recentReviews }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("subscription_status")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("shop_settings")
        .select(
          "shop_name, category, strengths, seo_keywords, auto_reply_enabled"
        )
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("reviews")
        .select("id, author_name, rating, content, published_at, created_at")
        .eq("user_id", user.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(3),
    ]);

  const status = parseStatus(profile?.subscription_status);
  const message = checkout ? checkoutMessages[checkout] : undefined;
  const keywords: string[] = settings?.seo_keywords ?? [];
  const autoReplyEnabled = Boolean(settings?.auto_reply_enabled);
  const isConfigured = Boolean(settings?.shop_name || settings?.strengths || keywords.length);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ようこそ。レビュー返信AIへようこそ。
        </p>
      </div>
      {message && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${message.className}`}
        >
          {message.text}
        </div>
      )}
      <PlanCard status={status} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>店舗設定</CardTitle>
            <Badge variant={isConfigured ? "secondary" : "outline"}>
              {isConfigured ? "登録済み" : "未登録"}
            </Badge>
          </div>
          <CardDescription>
            AIの返信文に使う店舗名・強み・SEOキーワード
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConfigured ? (
            <>
              <div className="space-y-2">
                {settings?.shop_name && (
                  <p className="font-medium">{settings.shop_name}</p>
                )}
                {settings?.strengths && (
                  <p className="text-sm text-muted-foreground">
                    {settings.strengths}
                  </p>
                )}
              </div>
              {keywords.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {keywords.map((keyword) => (
                    <li key={keyword}>
                      <Badge variant="secondary">{keyword}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant={autoReplyEnabled ? "default" : "outline"}>
                  自動返信 {autoReplyEnabled ? "ON" : "OFF"}
                </Badge>
                {settings?.category && <span>業種: {settings.category}</span>}
              </div>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/settings" />}
              >
                店舗設定を編集
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                店舗情報を登録すると、AIの返信文に店舗の強みやキーワードを反映できます。
              </p>
              <Button nativeButton={false} render={<Link href="/settings" />}>
                店舗設定を登録する
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>最新のレビュー</CardTitle>
            <Link
              href="/reviews"
              className={buttonVariants({ variant: "link", size: "sm" })}
            >
              すべて見る
            </Link>
          </div>
          <CardDescription>
            Googleマップから取得したレビュー
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentReviews && recentReviews.length > 0 ? (
            <ul className="space-y-4">
              {recentReviews.map((review) => (
                <li key={review.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StarRating rating={review.rating} />
                    <span className="text-sm font-medium">
                      {review.author_name ?? "名前のないお客様"}
                    </span>
                  </div>
                  {review.content && (
                    <p className="text-sm text-muted-foreground">
                      {review.content}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              まだレビューがありません。Googleマップ連携が完了すると自動で取得します。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
