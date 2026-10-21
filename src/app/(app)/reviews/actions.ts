"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateReply, isAiConfigured } from "@/lib/ai";
import {
  getAccessLevel,
  GOOGLE_CONNECTION_REQUIRED_MESSAGE,
  SUBSCRIPTION_REQUIRED_MESSAGE,
} from "@/lib/billing";
import { replyToReview, getReviewReply } from "@/lib/google/business";
import {
  getValidAccessToken,
  listConnections,
  type GbpConnection,
} from "@/lib/google/connections";
import { recordReply } from "@/lib/google/reviews";
import { claimReviews, releaseReviewClaim } from "@/lib/review-claims";
import { createClient } from "@/lib/supabase/server";

export type ReplyActionState = {
  status: "success" | "error";
  message: string;
  /** 生成した下書き。投稿はしないので保存せず、表示のためだけに戻します */
  draft?: string | null;
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

type ReplyTarget = {
  review: {
    id: string;
    location_id: string | null;
    external_id: string;
    author_name: string | null;
    rating: number;
    content: string | null;
    reply_text: string | null;
  };
  connection: GbpConnection;
  shop: {
    shop_name: string | null;
    category: string | null;
    strengths: string | null;
    seo_keywords: string[] | null;
  };
};

/**
 * 返信生成に必要な情報を揃えます。
 *
 * レビューの取得・Google連携の確認・店舗設定の取得は、下書き生成と
 * 実投稿で共通なので、ここにまとめます。
 */
async function prepareReplyGeneration(
  supabase: ServerClient,
  userId: string,
  reviewId: string
): Promise<{ ok: true; data: ReplyTarget } | { ok: false; message: string }> {
  const { data: review } = await supabase
    .from("reviews")
    .select(
      "id, location_id, external_id, author_name, rating, content, reply_text"
    )
    .eq("id", reviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!review) {
    return { ok: false, message: "レビューが見つかりませんでした。" };
  }

  if (review.reply_text) {
    return { ok: false, message: "このレビューには既に返信しています。" };
  }

  if (!isAiConfigured()) {
    return { ok: false, message: "AI返信機能の設定が完了していません。" };
  }

  const connections = await listConnections(userId);
  const connection = connections.find(
    (item) => item.location_id === review.location_id
  );
  if (!connection) {
    return { ok: false, message: GOOGLE_CONNECTION_REQUIRED_MESSAGE };
  }

  if (connection.status === "revoked") {
    return {
      ok: false,
      message:
        "Google連携の権限が失効しています。「店舗設定」から再度連携してください。",
    };
  }

  const { data: settings } = await supabase
    .from("shop_settings")
    .select("shop_name, category, strengths, seo_keywords")
    .eq("id", userId)
    .maybeSingle();

  return {
    ok: true,
    data: {
      review: review as ReplyTarget["review"],
      connection,
      shop: {
        shop_name: settings?.shop_name ?? null,
        category: settings?.category ?? null,
        strengths: settings?.strengths ?? null,
        seo_keywords: settings?.seo_keywords ?? [],
      },
    },
  };
}

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

  // Googleマップへの投稿は月額サブスクリプションの特典
  const access = await getAccessLevel(user.id);
  if (!access.canPostReplies) {
    return { status: "error", message: SUBSCRIPTION_REQUIRED_MESSAGE };
  }

  const prepared = await prepareReplyGeneration(supabase, user.id, reviewId);
  if (!prepared.ok) {
    return { status: "error", message: prepared.message };
  }

  const { review, connection } = prepared.data;

  // 同時に走った自動処理と対象が重ならないよう、排他的に確保する
  const claimedIds = await claimReviews(user.id, [review.id]);
  if (!claimedIds.includes(review.id)) {
    return {
      status: "error",
      message:
        "他の処理が進行中です。しばらくしてから再度お試しください。",
    };
  }

  try {
    const replyText = await generateReply({
      rating: review.rating,
      reviewText: review.content ?? "",
      reviewerName: review.author_name,
      shopName: prepared.data.shop.shop_name,
      category: prepared.data.shop.category,
      strengths: prepared.data.shop.strengths,
      seoKeywords: prepared.data.shop.seo_keywords ?? [],
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

/**
 * AI返信の下書きだけを作ります。
 *
 * Googleマップへは投稿しません。契約前でもAIの出来を確認できるように
 * するためです。下書きはDBに保存しないので、自動返信の対象から外れることは
 * ありません（保存すると「返信済み」と判定されて自動投稿が飛ばされます）。
 */
export async function generateReplyDraft(
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

  // 下書き作成はGoogleマップの連携があればできる（契約前でも可）
  const access = await getAccessLevel(user.id);
  if (!access.canGenerateReplies) {
    return { status: "error", message: GOOGLE_CONNECTION_REQUIRED_MESSAGE };
  }

  const prepared = await prepareReplyGeneration(supabase, user.id, reviewId);
  if (!prepared.ok) {
    return { status: "error", message: prepared.message };
  }

  const { review, shop } = prepared.data;

  try {
    const replyText = await generateReply({
      rating: review.rating,
      reviewText: review.content ?? "",
      reviewerName: review.author_name,
      shopName: shop.shop_name,
      category: shop.category,
      strengths: shop.strengths,
      seoKeywords: shop.seo_keywords ?? [],
    });

    return {
      status: "success",
      message: "下書きを作成しました。",
      draft: replyText,
    };
  } catch (error) {
    console.error("draft generation failed", error);
    return {
      status: "error",
      message:
        "AI返信の作成に失敗しました。時間をおいて再度お試しください。",
    };
  }
}
