import { generateReply, isAiConfigured } from "@/lib/ai";
import { getAccessLevel } from "@/lib/billing";
import { claimReviews, releaseReviewClaim } from "@/lib/review-claims";
import { replyToReview } from "./business";
import { getValidAccessToken, listActiveConnections } from "./connections";
import { recordReply } from "./reviews";
import { AUTO_REPLY_BATCH_SIZE } from "./sync-batch";
import { createAdminClient } from "@/lib/supabase/admin";

export async function autoReplyPendingReviews(userId: string): Promise<{
  replied: number;
  skipped: number;
}> {
  // 自動投稿は月額サブスクリプションの特典。未契約なら何もしない
  const access = await getAccessLevel(userId);
  if (!access.canAutoReply) {
    return { replied: 0, skipped: 0 };
  }

  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("shop_settings")
    .select("auto_reply_enabled, shop_name, strengths, seo_keywords, category")
    .eq("id", userId)
    .maybeSingle();

  if (!settings?.auto_reply_enabled) {
    return { replied: 0, skipped: 0 };
  }

  if (!isAiConfigured()) {
    return { replied: 0, skipped: 0 };
  }

  const { data: pending } = await admin
    .from("reviews")
    .select("id, location_id, external_id, author_name, rating, content")
    .eq("user_id", userId)
    .is("reply_text", null)
    .order("published_at", { ascending: true, nullsFirst: false })
    .limit(AUTO_REPLY_BATCH_SIZE);

  if (!pending || pending.length === 0) {
    return { replied: 0, skipped: 0 };
  }

  // 同時に走った実行と対象が重ならないよう、排他的に確保する
  const claimedIds = new Set(
    await claimReviews(
      userId,
      pending.map((row) => row.id)
    )
  );
  const targets = pending.filter((row) => claimedIds.has(row.id));

  // アクセストークンは店舗ごとに1回だけ取得する。
  // 取得に失敗した店舗は、その/reviewsだけ処理しない。
  // （レビューごとに_refreshすると、同じ失敗を何度も試してしまう）
  const connections = await listActiveConnections(userId);
  const accessTokens = new Map<string, string>();
  for (const connection of connections) {
    try {
      accessTokens.set(
        connection.location_id,
        await getValidAccessToken(connection)
      );
    } catch (error) {
      console.error(
        `auto reply skipped location ${connection.location_id}`,
        error
      );
    }
  }

  let replied = 0;

  for (const review of targets) {
    const accessToken = accessTokens.get(review.location_id ?? "");
    if (!accessToken) {
      await releaseReviewClaim(review.id);
      continue;
    }

    try {
      const replyText = await generateReply({
        rating: review.rating,
        reviewText: review.content ?? "",
        reviewerName: review.author_name,
        shopName: settings.shop_name,
        category: settings.category,
        strengths: settings.strengths,
        seoKeywords: settings.seo_keywords ?? [],
      });

      await replyToReview(review.external_id, replyText, accessToken);

      await recordReply({
        reviewId: review.id,
        replyText,
        autoReplied: true,
      });

      replied += 1;
    } catch (error) {
      console.error("auto reply failed for review", review.id, error);
      await releaseReviewClaim(review.id);
    }
  }

  return { replied, skipped: pending.length - replied };
}
