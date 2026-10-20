"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ShopSettingsState = {
  status: "success" | "error";
  message: string;
};

const MAX_KEYWORDS = 20;

export async function saveShopSettings(
  _prevState: ShopSettingsState,
  formData: FormData
): Promise<ShopSettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shopName = String(formData.get("shop_name") ?? "")
    .trim()
    .slice(0, 100);
  const strengths = String(formData.get("strengths") ?? "")
    .trim()
    .slice(0, 2000);
  const seoKeywords = String(formData.get("seo_keywords") ?? "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS);

  const { error } = await supabase.from("shop_settings").upsert(
    {
      id: user.id,
      shop_name: shopName || null,
      strengths,
      seo_keywords: seoKeywords,
    },
    { onConflict: "id" }
  );

  if (error) {
    return {
      status: "error",
      message: "保存できませんでした。時間をおいて再度お試しください。",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");

  return { status: "success", message: "店舗設定を保存しました。" };
}
