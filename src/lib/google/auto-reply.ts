import { generateReply, isAiConfigured } from "@/lib/ai";
import { replyToReview } from "./business";
import { getValidAccessToken, listConnections } from "./connections";
import { createAdminClient } from "@/lib/supabase/admin";

export async function autoReplyPendingReviews(userId: string): Promise<{
  replied: number;
  skipped: number;
}> {
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
    .order("published_at", { ascending: true, nullsFirst: false });

  if (!pending || pending.length === 0) {
    return { replied: 0, skipped: 0 };
  }

  const connections = await listConnections(userId);
  let replied = 0;

  for (const review of pending) {
    const connection = connections.find(
      (item) => item.location_id === review.location_id
    );
    if (!connection) continue;

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

      const accessToken = await getValidAccessToken(connection);
      await replyToReview(review.external_id, replyText, accessToken);

      await admin
        .from("reviews")
        .update({
          reply_text: replyText,
          replied_at: new Date().toISOString(),
          auto_replied: true,
        })
        .eq("id", review.id);

      replied += 1;
    } catch (error) {
      console.error("auto reply failed for review", review.id, error);
    }
  }

  return { replied, skipped: pending.length - replied };
}
