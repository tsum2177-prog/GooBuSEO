import { isSubscribed } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, listConnections } from "./connections";
import { listReviews, toStarRating } from "./business";

type ExistingReply = {
  reply_text: string | null;
  replied_at: string | null;
};

/**
 * 既に保存済みの返信履歴を取得します。
 *
 * GBPのレビュー一覧は、投稿済みレビューでも `reviewReply` が含まれないことが
 * あります（反映遅延や部分的な応答など）。その場合にローカル側の返信履歴を
 * NULLで上書きすると「未返信」と判定され、同じレビューへ二重に投稿されて
 * 公開済みの返信が別の文章に上書きされます。既存値を持ち越すために使います。
 */
async function fetchExistingReplies(
  userId: string,
  externalIds: string[]
): Promise<Map<string, ExistingReply>> {
  if (externalIds.length === 0) return new Map();

  const admin = createAdminClient();
  const { data } = await admin
    .from("reviews")
    .select("external_id, reply_text, replied_at")
    .eq("user_id", userId)
    .in("external_id", externalIds);

  return new Map(
    (data ?? []).map((row) => [
      row.external_id,
      { reply_text: row.reply_text, replied_at: row.replied_at },
    ])
  );
}

export async function syncReviews(userId: string): Promise<{
  imported: number;
  locations: number;
}> {
  // レビュー取得は月額サブスクリプションの特典。未契約なら何もしない
  if (!(await isSubscribed(userId))) {
    return { imported: 0, locations: 0 };
  }

  const connections = await listConnections(userId);
  if (connections.length === 0) {
    return { imported: 0, locations: 0 };
  }

  const admin = createAdminClient();
  let imported = 0;

  for (const connection of connections) {
    const accessToken = await getValidAccessToken(connection);
    const reviews = await listReviews(connection.location_id, accessToken);

    const existingReplies = await fetchExistingReplies(
      userId,
      reviews.map((review) => review.name)
    );

    const rows = reviews
      .map((review) => {
        const rating = toStarRating(review.starRating);
        if (rating === 0) return null;
        const existing = existingReplies.get(review.name);
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
          reply_text: review.reviewReply?.comment ?? existing?.reply_text ?? null,
          replied_at: review.reviewReply?.updateTime ?? existing?.replied_at ?? null,
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
