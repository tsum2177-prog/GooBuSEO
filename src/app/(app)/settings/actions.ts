"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteConnection } from "@/lib/google/connections";
import { autoReplyPendingReviews } from "@/lib/google/auto-reply";
import { syncReviews } from "@/lib/google/reviews";
import { createClient } from "@/lib/supabase/server";

export type SettingsActionState = {
  status: "success" | "error";
  message: string;
};

const MAX_KEYWORDS = 20;

export async function saveShopSettings(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shopName = String(formData.get("shop_name") ?? "")
    .trim()
    .slice(0, 100);
  const category = String(formData.get("category") ?? "")
    .trim()
    .slice(0, 50);
  const strengths = String(formData.get("strengths") ?? "")
    .trim()
    .slice(0, 2000);
  const seoKeywords = String(formData.get("seo_keywords") ?? "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS);
  const autoReplyEnabled = formData.get("auto_reply_enabled") === "on";

  const { error } = await supabase.from("shop_settings").upsert(
    {
      id: user.id,
      shop_name: shopName || null,
      category: category || null,
      strengths,
      seo_keywords: seoKeywords,
      auto_reply_enabled: autoReplyEnabled,
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

export async function syncReviewsAction(): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const { imported, locations } = await syncReviews(user.id);
    const auto = await autoReplyPendingReviews(user.id);
    revalidatePath("/reviews");
    revalidatePath("/dashboard");

    if (locations === 0) {
      return {
        status: "error",
        message: "Googleマップがまだ連携されていません。先に連携してください。",
      };
    }

    return {
      status: "success",
      message:
        `${locations}件の店舗から${imported}件のレビューを取得しました。` +
        (auto.replied > 0 ? `自動返信を${auto.replied}件投稿しました。` : ""),
    };
  } catch (error) {
    console.error("review sync failed", error);
    return {
      status: "error",
      message:
        "レビューを取得できませんでした。時間をおいて再度お試しください。",
    };
  }
}

export async function disconnectGoogleAction(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const connectionId = String(formData.get("connection_id") ?? "");
  if (!connectionId) {
    return { status: "error", message: "連携解除の対象が指定されていません。" };
  }

  try {
    await deleteConnection(user.id, connectionId);
    revalidatePath("/settings");
    return { status: "success", message: "連携を解除しました。" };
  } catch (error) {
    console.error("disconnect failed", error);
    return {
      status: "error",
      message:
        "連携を解除できませんでした。時間をおいて再度お試しください。",
    };
  }
}
