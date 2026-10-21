"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getAccessLevel,
  GOOGLE_CONNECTION_REQUIRED_MESSAGE,
} from "@/lib/billing";
import { deleteConnection } from "@/lib/google/connections";
import { autoReplyPendingReviews } from "@/lib/google/auto-reply";
import { syncReviews } from "@/lib/google/reviews";
import { parseSeoKeywords } from "@/lib/seo-keywords";
import { createClient } from "@/lib/supabase/server";

export type SettingsActionState = {
  status: "success" | "error";
  message: string;
};

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
  const seoKeywords = parseSeoKeywords(
    String(formData.get("seo_keywords") ?? "")
  );
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

  // レビュー取得はGoogleマップの連携があればできる（契約前でも可）
  const access = await getAccessLevel(user.id);
  if (!access.canReadReviews) {
    return { status: "error", message: GOOGLE_CONNECTION_REQUIRED_MESSAGE };
  }

  let imported = 0;
  let locations = 0;
  let allRevoked = false;
  let failures: { locationTitle: string | null; message: string }[] = [];

  try {
    const result = await syncReviews(user.id);
    imported = result.imported;
    locations = result.locations;
    failures = result.failures;
    allRevoked = result.allRevoked;
  } catch (error) {
    console.error("review sync failed", error);
    return {
      status: "error",
      message: "レビューを取得できませんでした。時間をおいて再度お試しください。",
    };
  }

  // 取得に失敗した店舗があっても、自動返信の処理は続行する
  let replied = 0;
  try {
    const auto = await autoReplyPendingReviews(user.id);
    replied = auto.replied;
  } catch (error) {
    console.error("auto reply failed", error);
  }

  revalidatePath("/reviews");
  revalidatePath("/dashboard");

  if (locations === 0) {
    return {
      status: "error",
      message: allRevoked
        ? "Google連携の権限が失効しています。下の「Googleマップと再連携する」から再度連携してください。"
        : "Googleマップがまだ連携されていません。先に連携してください。",
    };
  }

  if (failures.length > 0) {
    const names = failures
      .map((failure) => failure.locationTitle ?? failure.message)
      .join("、");
    return {
      status: "error",
      message: `${locations}件の店舗のうち${failures.length}件で取得に失敗しました（${names}）。Google連携の権限が失効している場合は「店舗設定」で再度連携してください。`,
    };
  }

  return {
    status: "success",
    message:
      `${locations}件の店舗から${imported}件のレビューを取得しました。` +
      (replied > 0 ? `自動返信を${replied}件投稿しました。` : ""),
  };
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
