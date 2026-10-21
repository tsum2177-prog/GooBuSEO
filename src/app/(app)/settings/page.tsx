import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SubscriptionNotice } from "@/components/billing/subscription-notice";
import { GoogleConnectionCard } from "@/components/settings/google-connection-card";
import { ShopSettingsForm } from "@/components/settings/shop-settings-form";
import { getAccessLevel } from "@/lib/billing";
import { getUser } from "@/lib/auth";
import { listConnections } from "@/lib/google/connections";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "店舗設定",
};

export const dynamic = "force-dynamic";

const googleMessages: Record<string, { text: string; className: string }> = {
  connected: {
    text: "Googleマップと連携しました。",
    className:
      "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100",
  },
  no_location: {
    text: "管理できる店舗が見つかりませんでした。Googleマップ的管理権限があるか確認してください。",
    className: "border-border bg-muted text-foreground",
  },
  need_reconsent: {
    text: "アクセス許可がタイムアウトしました。もう一度連携してください。",
    className: "border-border bg-muted text-foreground",
  },
  not_configured: {
    text: "Google連携の設定がまだ完了していません。",
    className: "border-border bg-muted text-foreground",
  },
  error: {
    text: "Googleマップとの連携に失敗しました。時間をおいて再度お試しください。",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("shop_settings")
    .select(
      "shop_name, category, strengths, seo_keywords, auto_reply_enabled"
    )
    .eq("id", user.id)
    .maybeSingle();

  const access = await getAccessLevel(user.id);
  const connections = await listConnections(user.id).catch(() => []);
  const message = google ? googleMessages[google] : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">店舗設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          店舗名と業種はGoogleマップから自動で入ります。AIの返信文をより店舗
          に合わせるために、任意の項目を追加してください。
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
      {!access.canPostReplies && <SubscriptionNotice />}
      <GoogleConnectionCard
        locations={connections.map((connection) => ({
          id: connection.id,
          title: connection.location_title,
          status: connection.status,
        }))}
        googleConfigured={isGoogleConfigured()}
      />
      <ShopSettingsForm
        // サーバー側で整形された値と一致させるため、保存後にキーが変わったら作り直す
        key={JSON.stringify(settings)}
        initial={{
          shopName: settings?.shop_name ?? "",
          category: settings?.category ?? "",
          strengths: settings?.strengths ?? "",
          seoKeywords: settings?.seo_keywords ?? [],
          autoReplyEnabled: settings?.auto_reply_enabled ?? false,
        }}
        canAutoReply={access.canAutoReply}
      />
    </div>
  );
}
