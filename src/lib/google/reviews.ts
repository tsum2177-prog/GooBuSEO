import { getAccessLevel } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { listConnections, withValidAccessToken } from "./connections";
import { listReviews, toStarRating } from "./business";

type ExistingReply = {
  reply_text: string | null;
  replied_at: string | null;
};

export type SyncFailure = {
  locationId: string;
  locationTitle: string | null;
  message: string;
};

export type SyncResult = {
  imported: number;
  locations: number;
  failures: SyncFailure[];
  /** 連携はあるが、すべて失効（revoked）している */
  allRevoked: boolean;
};

/**
 * 既に保存済みの返信履歴を取得します。
 *
 * GBPのレビュー一覧は、投稿済みレビューでも `reviewReply` が含まれないことが
 * あります（反映遅延や部分的な応答など）。その場合にローカル側の返信履歴を
 * NULL で上書きすると「未返信」と判定され、同じレビューへ二重に投稿されて
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

export async function syncReviews(userId: string): Promise<SyncResult> {
  // レビュー取得はGoogleマップの連携があればできる。
  // 契約していない場合は1店舗だけ処理する（クォータとAIコストの保護）。
  const access = await getAccessLevel(userId);
  if (!access.canReadReviews) {
    return { imported: 0, locations: 0, failures: [], allRevoked: false };
  }

  const connections = await listConnections(userId);
  const active = connections
    .filter((connection) => connection.status !== "revoked")
    .slice(0, access.maxLocations);

  if (active.length === 0) {
    return {
      imported: 0,
      locations: 0,
      failures: [],
      // 連携はあるが全て失効している。呼び出し側で再連携を促すために区別する
      allRevoked: connections.length > 0,
    };
  }

  const admin = createAdminClient();
  let imported = 0;
  const failures: SyncFailure[] = [];

  for (const connection of active) {
    // 1つの店舗で失敗しても、ほかの店舗は処理を続ける。
    // 失効したトークンを持つ店舗がいても、全体の取得が止まってはいけない。
    try {
      // 401（アクセスの失効）が起きたときは、接続を `revoked` に保存して
      // 以降のcronが同じ接続を叩き続けないようにします。
      // 1店舗で失敗してもループは止まらない（下の catch で失敗情報を記録します）。
      const reviews = await withValidAccessToken(connection, (accessToken) =>
        listReviews(connection.location_id, accessToken)
      );

      const existingReplies = await fetchExistingReplies(
        userId,
        reviews.map((review) => review.name)
      );

      const rows = reviews
        .map((review) => {
          const rating = toStarRating(review.starRating);
          if (rating === 0) {
            if (review.starRating) {
              // 未知のレーティングだと無言で取りこぼすので、原因を追えるようにログを残す
              console.warn("未知のレーティングのレビューは取りこぼしました", {
                externalId: review.name,
                starRating: review.starRating,
              });
            }
            return null;
          }
          const existing = existingReplies.get(review.name);
          // upsert に入れる列を「保存履歴の列」に限定している。
          //
          // auto_replied（マイグレーション5）/ claimed_at（6）/ posted_via（10）を
          // ここに入れると、マイグレーションが未適用の環境では PostgREST が列を
          // 見つけられず**リクエストごと**失敗する。すると「未返信」と誤判定されて
          // 二重投稿につながる。upsert は列を含めない場合、更新時は既存値を保持し、
          // 挿入時はカラムのデフォルトが使われるため、意図どおりに振る舞える。
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
            reply_text:
              review.reviewReply?.comment ?? existing?.reply_text ?? null,
            replied_at:
              review.reviewReply?.updateTime ?? existing?.replied_at ?? null,
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
    } catch (error) {
      console.error(
        `店舗 ${connection.location_id} のレビュー取得に失敗しました`,
        error
      );
      failures.push({
        locationId: connection.location_id,
        locationTitle: connection.location_title,
        message:
          error instanceof Error ? error.message : "レビュー取得に失敗しました",
      });
    }
  }

  // 失効している連携は取得を試みず、そのまま結果に残して再連携を促す
  for (const connection of connections) {
    if (connection.status === "revoked") {
      failures.push({
        locationId: connection.location_id,
        locationTitle: connection.location_title,
        message: "Google連携の権限が失効しています。再度連携してください",
      });
    }
  }

  return {
    imported,
    locations: active.length,
    failures,
    allRevoked: false,
  };
}

/**
 * Googleへ投稿した返信をローカルに記録します。
 *
 * Googleへの投稿は取り消せません。記録に失敗するとこの行は
 * 「未返信」のまま残り、次回の実行が**別の文を生成して
 * 公開済みの返信を置き換える**ことになります。そこで再試行し、
 * それでも失敗したら運用工程で分かるように大きなログを残します。
 */
export async function recordReply(input: {
  reviewId: string;
  userId: string;
  replyText: string;
  autoReplied: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const base = {
    reply_text: input.replyText,
    replied_at: new Date().toISOString(),
    auto_replied: input.autoReplied,
  };

  // user_id は必ず絞ります。RLSはservice_roleでは迂回されるため、
  // DB側でテナント境界を守らないと他ユーザーのレビューを書き換えられます。
  const save = (payload: Record<string, unknown>) =>
    admin
      .from("reviews")
      .update(payload)
      .eq("id", input.reviewId)
      .eq("user_id", input.userId);

  // 出所を残す。NULL のままの返信は「取得で同期したもの」と区別する
  const first = await save({
    ...base,
    posted_via: input.autoReplied ? "ai_auto" : "ai_manual",
  });
  if (!first.error) return;

  // posted_via カラムが未適用の環境では、列が無いことが原因の可能性が高い。
  // それ以外の原因でも、基本のペイロードで1回だけ試す。
  console.error(
    "投稿した返信を保存できませんでした。基本のペイロードで再試行します",
    first.error
  );

  const second = await save(base);
  if (!second.error) return;

  console.error(
    "CRITICAL: Googleへ投稿した返信をローカルへ保存できませんでした。" +
      "次回の実行で、公開済みの返信が別の文に上書きされる恐れがあります。",
    { reviewId: input.reviewId, error: second.error }
  );
}
