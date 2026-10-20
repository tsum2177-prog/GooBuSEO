"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateReply, isAiConfigured } from "@/lib/ai";
import { replyToReview } from "@/lib/google/business";
import { getValidAccessToken, listConnections } from "@/lib/google/connections";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ReplyActionState = {
  status: "success" | "error";
  message: string;
};

export async function generateAndPostReply(
  _prevState: ReplyActionState,
  formData: FormData
): Promise<ReplyActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reviewId = String(formData.get("review_id") ?? "");
  if (!reviewId) {
    return { status: "error", message: "対象のレビューが指定されていません。" };
  }

  const { data: review } = await supabase
    .from("reviews")
    .select("id, location_id, external_id, author_name, rating, content")
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!review) {
    return { status: "error", message: "レビューが見つかりませんでした。" };
  }

  if (!isAiConfigured()) {
    return {
      status: "error",
      message: "AI返信機能の設定が完了していません。",
    };
  }

  try {
    const connections = await listConnections(user.id);
    const connection = connections.find(
      (item) => item.location_id === review.location_id
    );
    if (!connection) {
      return {
        status: "error",
        message: "Googleマップがまだ連携されていません。先に連携してください。",
      };
    }

    const { data: settings } = await supabase
      .from("shop_settings")
      .select("shop_name, strengths, seo_keywords")
      .eq("id", user.id)
      .maybeSingle();

    const replyText = await generateReply({
      rating: review.rating,
      reviewText: review.content ?? "",
      reviewerName: review.author_name,
      shopName: settings?.shop_name,
      strengths: settings?.strengths,
      seoKeywords: settings?.seo_keywords ?? [],
    });

    const accessToken = await getValidAccessToken(connection);
    await replyToReview(review.external_id, replyText, accessToken);

    const admin = createAdminClient();
    await admin
      .from("reviews")
      .update({
        reply_text: replyText,
        replied_at: new Date().toISOString(),
        auto_replied: false,
      })
      .eq("id", review.id)
      .eq("user_id", user.id);

    revalidatePath("/reviews");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: "AI返信をGoogleマップに投稿しました。",
    };
  } catch (error) {
    console.error("reply failed", error);
    return {
      status: "error",
      message:
        "AI返信の作成・投稿に失敗しました。時間をおいて再度お試しください。",
    };
  }
}
