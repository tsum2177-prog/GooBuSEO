import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { GoogleConnectionCard } from "@/components/settings/google-connection-card";
import { ShopSettingsForm } from "@/components/settings/shop-settings-form";
import { listConnections } from "@/lib/google/connections";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "店舗設定",
};

export const instant = false;

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
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: settings }, connections] = await Promise.all([
    supabase
      .from("shop_settings")
      .select(
        "shop_name, category, strengths, seo_keywords, auto_reply_enabled"
      )
      .eq("id", user.id)
      .maybeSingle(),
    listConnections(user.id).catch(() => []),
  ]);

  const message = google ? googleMessages[google] : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">店舗設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          店舗の情報を登録しておくと、AIの返信文にその情報を反映できます。
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
      <GoogleConnectionCard
        locations={connections.map((connection) => ({
          id: connection.id,
          title: connection.location_title,
        }))}
        googleConfigured={isGoogleConfigured()}
      />
      <ShopSettingsForm
        initial={{
          shopName: settings?.shop_name ?? "",
          category: settings?.category ?? "",
          strengths: settings?.strengths ?? "",
          seoKeywords: settings?.seo_keywords ?? [],
          autoReplyEnabled: settings?.auto_reply_enabled ?? false,
        }}
      />
    </div>
  );
}
