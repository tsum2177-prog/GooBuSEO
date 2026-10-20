import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, listConnections } from "./connections";
import { listReviews, toStarRating } from "./business";

export async function syncReviews(userId: string): Promise<{
  imported: number;
  locations: number;
}> {
  const connections = await listConnections(userId);
  if (connections.length === 0) {
    return { imported: 0, locations: 0 };
  }

  const admin = createAdminClient();
  let imported = 0;

  for (const connection of connections) {
    const accessToken = await getValidAccessToken(connection);
    const reviews = await listReviews(connection.location_id, accessToken);

    const rows = reviews
      .map((review) => {
        const rating = toStarRating(review.starRating);
        if (rating === 0) return null;
        return {
          user_id: userId,
          location_id: connection.location_id,
          external_id: review.name,
          author_name: review.reviewer?.isAnonymous
            ? null
            : (review.reviewer?.displayName ?? null),
          rating,
          content: review.comment ?? null,
          published_at: review.createTime ?? null,
          reply_text: review.reviewReply?.comment ?? null,
          replied_at: review.reviewReply?.updateTime ?? null,
        };
      })
      .filter((row) => row !== null);

    if (rows.length === 0) continue;

    const { error } = await admin
      .from("reviews")
      .upsert(rows, { onConflict: "user_id,external_id" });

    if (error) {
      throw new Error("レビューの保存に失敗しました");
    }

    imported += rows.length;
  }

  return { imported, locations: connections.length };
}
