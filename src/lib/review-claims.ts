import { createAdminClient } from "@/lib/supabase/admin";

/**
 * claimが取り残された場合の回収しきい値。
 * この時間を超えたclaimは前回の実行が中断されたものとみなして解放する。
 */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 返信が未着のレビューを排他的に確保し、確保できたIDを返します。
 *
 * 条件付きUPDATEなので、cronと手動操作が同時に走っても
 * 同じ行を確保できるのは一方だけになります。
 *
 * `claimed_at` カラムはマイグレーション `20261020120400_add_claim_and_preserve_reply.sql`
 * で追加します。未適用の場合は排他制御なしで処理を続行します
 * （自動返信が動かなくなるより、二重投稿の危険が残るほうが望ましいため）。
 */
export async function claimReviews(
  userId: string,
  reviewIds: string[]
): Promise<string[]> {
  if (reviewIds.length === 0) return [];

  const admin = createAdminClient();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();

  // 前回の実行が中断されて取り残されたclaimを解放する
  await admin
    .from("reviews")
    .update({ claimed_at: null })
    .eq("user_id", userId)
    .is("reply_text", null)
    .lt("claimed_at", staleBefore);

  const { data, error } = await admin
    .from("reviews")
    .update({ claimed_at: now.toISOString() })
    .in("id", reviewIds)
    .eq("user_id", userId)
    .is("reply_text", null)
    .is("claimed_at", null)
    .select("id");

  if (error) {
    console.error(
      "review claim failed (claimed_at migration may be missing); continuing without exclusive lock",
      error
    );
    return reviewIds;
  }

  return (data ?? []).map((row) => row.id);
}

/**
 * 処理に失敗したレビューのclaimを解放し、次の実行で再試行できるようにします。
 */
export async function releaseReviewClaim(reviewId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("reviews")
    .update({ claimed_at: null })
    .eq("id", reviewId);
}
