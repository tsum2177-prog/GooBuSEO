import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShopSettingsForm } from "@/components/settings/shop-settings-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "店舗設定",
};

export const instant = false;

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: settings } = await supabase
    .from("shop_settings")
    .select("shop_name, strengths, seo_keywords")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">店舗設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          店舗の情報を登録しておくと、AIの返信文にその情報を反映できます。
        </p>
      </div>
      <ShopSettingsForm
        initial={{
          shopName: settings?.shop_name ?? "",
          strengths: settings?.strengths ?? "",
          seoKeywords: settings?.seo_keywords ?? [],
        }}
      />
    </div>
  );
}
