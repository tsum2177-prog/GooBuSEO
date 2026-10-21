"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateReply, isAiConfigured } from "@/lib/ai";
import {
  isSubscribed,
  SUBSCRIPTION_REQUIRED_MESSAGE,
} from "@/lib/billing";
import { replyToReview, getReviewReply } from "@/lib/google/business";
import { getValidAccessToken, listConnections } from "@/lib/google/connections";
import { recordReply } from "@/lib/google/reviews";
import { claimReviews, releaseReviewClaim } from "@/lib/review-claims";
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

  if (!(await isSubscribed(user.id))) {
    return { status: "error", message: SUBSCRIPTION_REQUIRED_MESSAGE };
  }

  const { data: review } = await supabase
    .from("reviews")
    .select(
      "id, location_id, external_id, author_name, rating, content, reply_text"
    )
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!review) {
    return { status: "error", message: "レビューが見つかりませんでした。" };
  }

  if (review.reply_text) {
    return {
      status: "error",
      message: "このレビューには既に返信しています。",
    };
  }

  if (!isAiConfigured()) {
    return {
      status: "error",
      message: "AI返信機能の設定が完了していません。",
    };
  }

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

  if (connection.status === "revoked") {
    return {
      status: "error",
      message:
        "Google連携の権限が失効しています。「店舗設定」から再度連携してください。",
    };
  }

  // 同時に走った自動処理と対象が重ならないよう、排他的に確保する
  const claimedIds = await claimReviews(user.id, [review.id]);
  if (!claimedIds.includes(review.id)) {
    return {
      status: "error",
      message: "他の処理が進行中です。しばらくしてから再度お試しください。",
    };
  }

  try {
    const { data: settings } = await supabase
      .from("shop_settings")
      .select("shop_name, category, strengths, seo_keywords")
      .eq("id", user.id)
      .maybeSingle();

    const replyText = await generateReply({
      rating: review.rating,
      reviewText: review.content ?? "",
      reviewerName: review.author_name,
      shopName: settings?.shop_name,
      category: settings?.category,
      strengths: settings?.strengths,
      seoKeywords: settings?.seo_keywords ?? [],
    });

    const accessToken = await getValidAccessToken(connection);

    // 投稿する前に、Google側にすでに返信があるかを確認する。
    // 最後の同期以降に、店主がGoogleマップ上で直接返信している可能性がある。
    const remoteReply = await getReviewReply(review.external_id, accessToken);
    if (remoteReply?.comment) {
      await releaseReviewClaim(review.id);
      return {
        status: "error",
        message:
          "このレビューにはGoogleマップ上すでに返信があります。上書きするとそちらが消えるため、投稿を中止しました。",
      };
    }

    await replyToReview(review.external_id, replyText, accessToken);

    await recordReply({
      reviewId: review.id,
      userId: user.id,
      replyText,
      autoReplied: false,
    });

    revalidatePath("/reviews");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: "AI返信をGoogleマップに投稿しました。",
    };
  } catch (error) {
    console.error("reply failed", error);
    await releaseReviewClaim(review.id);
    return {
      status: "error",
      message:
        "AI返信の作成・投稿に失敗しました。時間をおいて再度お試しください。",
    };
  }
}
