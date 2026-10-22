import { generateReply, isAiConfigured } from "@/lib/ai";
import { getAccessLevel } from "@/lib/billing";
import { claimReviews, releaseReviewClaim } from "@/lib/review-claims";
import { getReviewReply, replyToReview } from "./business";
import {
  getValidAccessToken,
  listActiveConnections,
  listConnections,
  withValidAccessToken,
  type GbpConnection,
} from "./connections";
import { GoogleAuthError } from "./oauth";
import { recordReply } from "./reviews";
import { AUTO_REPLY_BATCH_SIZE } from "./sync-batch";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 自動返信の試行回数の上限です。
 *
 * AIの返信文が空文字や日本語でない文になるなど、レビュー固有の失敗が
 * 繰り返されると、そのレビューが「未返信」の先頭に留まり、バッチの枠を
 * 他のレビューに回せません（poison pill）。この回数に達したレビューは
 * 自動返信の対象から外します。
 */
const MAX_AUTO_REPLY_ATTEMPTS = 5;

/** service_role のクライアント */
type AdminClient = ReturnType<typeof createAdminClient>;

/** 自動返信の対象となるレビュー */
type PendingReview = {
  id: string;
  location_id: string | null;
  external_id: string;
  author_name: string | null;
  rating: number;
  content: string | null;
  auto_reply_attempts: number | null;
};

/** 試行回数が上限に達して、対象から外れたレビュー */
type ExhaustedReview = {
  id: string;
  location_id: string | null;
  external_id: string;
  auto_reply_attempts: number | null;
};

/** Googleマップ上にある既存の返信 */
type RemoteReply = {
  comment: string;
  updateTime: string | null;
};

/** 対象レビューの取得結果 */
type PendingSelection = {
  pending: PendingReview[];
  exhausted: ExhaustedReview[];
  exhaustedCount: number;
  /** 試行回数の列が存在するかどうか（未適用なら poison pill 対策が無効） */
  attemptsSupported: boolean;
};

const PENDING_COLUMNS =
  "id, location_id, external_id, author_name, rating, content";
const PENDING_COLUMNS_WITH_ATTEMPTS = `${PENDING_COLUMNS}, auto_reply_attempts`;

/**
 * Supabaseの応答を行配列として取り出します。
 * 型が付けられていないクライアントの戻り値を、行の型へ読み替えます。
 */
function toRows<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value as T[];
}

/**
 * 試行回数を読みます。列が未適用の場合など、値が読めなければ0。
 */
function readAttempts(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const raw = (value as { auto_reply_attempts?: unknown }).auto_reply_attempts;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * 記録済みの返信文を読みます。未記録なら null。
 */
function readReplyText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { reply_text?: unknown }).reply_text;
  return typeof raw === "string" ? raw : null;
}

/**
 * Google API のエラーの HTTP ステータスを読みます。
 * `GoogleApiError` は `status` を持つため、形から取り出します。
 */
function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/**
 * 連携の失効（401・トークンの失効）を示すエラーかどうかを判定します。
 *
 * `withValidAccessToken` は GBP API が 401 を返すと接続を `revoked` に保存し、
 * 再連携を促す `GoogleAuthError` を投げます。失効した連携のレビューは
 * レビュー固有の問題ではなく、再連携で解消します。
 */
function isRevokedAccessError(error: unknown): boolean {
  if (error instanceof GoogleAuthError) {
    return error.code === "access_revoked" || error.code === "invalid_grant";
  }
  return getErrorStatus(error) === 401;
}

/**
 * 一時的な障害で失敗したかどうかを判定します。
 *
 * - 429（クォータ）、5xx、タイムアウト、401（トークン失効）、応答なしは
 *   一時的な障害なので、レビュー固有の失敗として試行回数を増やしません。
 * - それ以外（AIの文が日本語でない、レビューが見つからないなど）は同じ
 *   レビューで繰り返すため、試行回数を増やして対象から外します。
 */
function isTransientFailure(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== null) {
    if (status === 0 || status === 401 || status === 408 || status === 429) {
      return true;
    }
    return status >= 500;
  }

  // 連携の失効はレビュー固有の失敗ではない（再連携で解消する）ため、
  // 試行回数を増やしてレビューを恒久的に対象から外さない
  if (isRevokedAccessError(error)) {
    return true;
  }

  // AI APIのエラー（429/5xxなど）とAPIキー未設定は一時的な障害
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("AI APIでエラーが発生しました") ||
    message.includes("GEMINI_API_KEY")
  ) {
    return true;
  }

  // ステータスやリトライの記載があるAPIエラーも、一時的な障害として扱います
  return (
    /\b(429|5\d{2})\b/.test(message) ||
    message.includes("タイムアウト") ||
    message.toLowerCase().includes("timeout")
  );
}

/**
 * 自動返信の対象になるレビューを取得します。
 *
 * 試行回数が上限に達したレビューはクエリから除外し、limit の枠を
 * 他のレビューに回せるようにします。`auto_reply_attempts` 列が未適用の
 * 環境では、上限の判定を諦めて従来どおり処理します。
 */
async function loadPendingReviews(
  admin: AdminClient,
  userId: string
): Promise<PendingSelection> {
  const { data, error } = await admin
    .from("reviews")
    .select(PENDING_COLUMNS_WITH_ATTEMPTS)
    .eq("user_id", userId)
    .is("reply_text", null)
    .lt("auto_reply_attempts", MAX_AUTO_REPLY_ATTEMPTS)
    .order("published_at", { ascending: true, nullsFirst: false })
    .limit(AUTO_REPLY_BATCH_SIZE);

  if (!error) {
    // 上限に達したレビューは、警告に残すためだけに取り出します
    const exhaustedQuery = await admin
      .from("reviews")
      .select("id, location_id, external_id, auto_reply_attempts", {
        count: "exact",
      })
      .eq("user_id", userId)
      .is("reply_text", null)
      .gte("auto_reply_attempts", MAX_AUTO_REPLY_ATTEMPTS)
      .limit(AUTO_REPLY_BATCH_SIZE);

    if (exhaustedQuery.error) {
      console.warn(
        "試行回数が上限に達したレビューの取得に失敗しました",
        exhaustedQuery.error
      );
    }

    return {
      pending: toRows<PendingReview>(data),
      exhausted: toRows<ExhaustedReview>(exhaustedQuery.data),
      exhaustedCount: exhaustedQuery.count ?? 0,
      attemptsSupported: true,
    };
  }

  // 列が未適用の環境では、poison pill 対策だけを諦めて従来どおり処理します
  console.warn(
    "auto_reply_attempts 列が未適用のため、試行回数による除外処理を行いません",
    error
  );

  const { data: fallback } = await admin
    .from("reviews")
    .select(PENDING_COLUMNS)
    .eq("user_id", userId)
    .is("reply_text", null)
    .order("published_at", { ascending: true, nullsFirst: false })
    .limit(AUTO_REPLY_BATCH_SIZE);

  return {
    pending: toRows<PendingReview>(fallback),
    exhausted: [],
    exhaustedCount: 0,
    attemptsSupported: false,
  };
}

/**
 * 自動返信の試行回数を1増やします。
 *
 * `auto_reply_attempts` 列はマイグレーション
 * `20261021110000_add_auto_reply_attempts.sql` で追加します。
 */
async function incrementAutoReplyAttempts(
  admin: AdminClient,
  reviewId: string,
  userId: string
): Promise<void> {
  const { data, error } = await admin
    .from("reviews")
    .select("auto_reply_attempts")
    .eq("id", reviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("自動返信の試行回数を読み取れませんでした", {
      reviewId,
      error,
    });
    return;
  }

  const { error: updateError } = await admin
    .from("reviews")
    .update({ auto_reply_attempts: readAttempts(data) + 1 })
    .eq("id", reviewId)
    .eq("user_id", userId);

  if (updateError) {
    console.warn("自動返信の試行回数を更新できませんでした", {
      reviewId,
      error: updateError,
    });
  }
}

/**
 * 自動返信の試行回数を0に戻します。
 *
 * Googleマップ上に既存の返信が見つかったときや、返信の記録に成功した
 * ときに呼びます。再び試せるようにしておくためです。
 */
async function resetAutoReplyAttempts(
  admin: AdminClient,
  reviewId: string,
  userId: string
): Promise<void> {
  const { error } = await admin
    .from("reviews")
    .update({ auto_reply_attempts: 0 })
    .eq("id", reviewId)
    .eq("user_id", userId);

  if (error) {
    console.warn("自動返信の試行回数をリセットできませんでした", {
      reviewId,
      error,
    });
  }
}

/**
 * Googleマップ上にある既存の返信を取得します。
 *
 * 404 は「返信がない」を意味するので、そのまま投稿を進めます。
 * それ以外のエラーは上書きの危険があるため、呼び出し側で投稿を見送ります。
 */
async function fetchRemoteReply(
  externalId: string,
  accessToken: string
): Promise<RemoteReply | null> {
  try {
    const reply = await getReviewReply(externalId, accessToken);
    if (!reply?.comment) return null;
    return { comment: reply.comment, updateTime: reply.updateTime ?? null };
  } catch (error) {
    if (getErrorStatus(error) === 404) return null;
    throw error;
  }
}

/**
 * Googleマップ上にある既存の返信をローカルへ取り込みます。
 *
 * これにより「未返信」のまま残ったレビューが毎回チェックに時間を費やし、
 * 他のレビューを処理できなくなることを防ぎます。
 */
async function syncRemoteReply(
  admin: AdminClient,
  reviewId: string,
  userId: string,
  reply: RemoteReply
): Promise<void> {
  const { error } = await admin
    .from("reviews")
    .update({
      reply_text: reply.comment,
      replied_at: reply.updateTime ?? new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("user_id", userId);

  if (error) {
    console.warn("既存の返信をローカルへ取り込めませんでした", {
      reviewId,
      error,
    });
  }
}

/**
 * 返信の記録が実際に反映されたかを確認します。
 *
 * `recordReply` は失敗しても例外を投げずにログだけを残します。
 * 呼び出し側では成否が分からないため、自分でも読み直して確認します。
 */
async function isReplyRecorded(
  admin: AdminClient,
  reviewId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("reviews")
    .select("reply_text")
    .eq("id", reviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("返信の記録を確認できませんでした", { reviewId, error });
    return false;
  }

  return readReplyText(data) !== null;
}

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

  const { pending, exhausted, exhaustedCount, attemptsSupported } =
    await loadPendingReviews(admin, userId);

  let replied = 0;
  // 試行回数が上限に達したレビューは、投稿せずにスキップとして数えます
  let skipped = exhaustedCount;

  for (const review of exhausted) {
    console.warn(
      `自動返信の試行回数が上限（${MAX_AUTO_REPLY_ATTEMPTS}回）に達したため、` +
        `このレビューは自動返信の対象から外しました` +
        `（レビューID: ${review.id}、店舗ID: ${review.location_id ?? "不明"}、` +
        `試行回数: ${review.auto_reply_attempts ?? 0}）`
    );
  }

  if (pending.length === 0) {
    return { replied, skipped };
  }

  // 同時に走った実行と対象が重ならないよう、排他的に確保する
  const claimedIds = new Set(
    await claimReviews(
      userId,
      pending.map((row) => row.id)
    )
  );
  const targets = pending.filter((row) => claimedIds.has(row.id));

  // 他の実行が処理中のレビューも「今回はスキップ」として数えます
  skipped += pending.length - targets.length;

  // アクセストークンは店舗ごとに1回だけ取得してcacheする。
  // 取得に失敗した店舗は、その店舗だけを処理対象から外す。
  // （レビューごとにrefreshすると、同じ失敗を何度も試してしまう）
  // cacheは「その店舗を処理できるか」を判定するためにも使います。
  // 実際のAPI呼び出しに使われるトークンは `withValidAccessToken` が返します
  // （期限切れならその場で更新されます）。
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
        `店舗 ${connection.location_id} のアクセストークン取得に失敗したため、` +
          `この店舗は処理しません`,
        error
      );
    }
  }

  // 401（アクセスの失効）が起きた店舗を、この実行では以降処理しません。
  // 失効の記録（`revoked` への保存）は `withValidAccessToken` が行います。
  const revokedLocations = new Set<string>();

  // トークンの更新でDBの値が書き換わっているため、接続情報を読み返します。
  // 読み返さないと、レビューごとに `withValidAccessToken` がトークンを
  // 取り直してしまいます（tokenエンドポイントへの呼び出しが増えます）。
  // 読み返せなかった場合は、最初に取得した接続情報をそのまま使います。
  const latestConnections = await listConnections(userId);
  const connectionsByLocation = new Map<string, GbpConnection>(
    connections.map((connection) => [connection.location_id, connection])
  );
  for (const connection of latestConnections) {
    connectionsByLocation.set(connection.location_id, connection);
  }

  for (const review of targets) {
    const locationId = review.location_id ?? "";
    const accessToken = accessTokens.get(locationId);
    const connection = connectionsByLocation.get(locationId);
    if (!accessToken || !connection) {
      // トークンを取得できなかった店舗（または連携が既に消えている）は処理しません
      await releaseReviewClaim(review.id, userId);
      skipped += 1;
      continue;
    }

    // 同じ実行の中で既に失効扱いになった店舗は、残りのレビューも処理しません
    if (revokedLocations.has(locationId)) {
      await releaseReviewClaim(review.id, userId);
      skipped += 1;
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

      // 投稿する直前に、Googleマップ上に既存の返信がないかを確認します。
      // GBPのレビュー取得レスポンスには replyReply が含まれないことがあり、
      // その場合、店主がマップ上で直接返信していてもローカルは「未返信」の
      // ままです。ここで確認せずに投稿すると、公開済みの返信が別のAI文で
      // 上書きされます（公開レビューは差し替えできず、元に戻せません）。
      let remoteReply: RemoteReply | null = null;
      try {
        remoteReply = await withValidAccessToken(connection, (token) =>
          fetchRemoteReply(review.external_id, token)
        );
      } catch (error) {
        // 401（アクセスの失効）なら接続は失効扱いになるので、
        // この店舗以降のレビューは処理しません。
        if (isRevokedAccessError(error)) {
          revokedLocations.add(locationId);
        }

        // 確認できないまま投稿すると上書きの危険があります。
        // 安全側に倒して、今回の実行では投稿を見送ります。
        console.warn(
          `Googleマップ上の既存返信を確認できなかったため、` +
            `このレビューの投稿を見送りました` +
            `（レビューID: ${review.id}、店舗ID: ${review.location_id ?? "不明"}）`,
          error
        );
        await releaseReviewClaim(review.id, userId);
        skipped += 1;
        continue;
      }

      if (remoteReply) {
        console.warn(
          `Googleマップ上に既存の返信があるため投稿をスキップしました` +
            `（レビューID: ${review.id}、店舗ID: ${review.location_id ?? "不明"}）`
        );

        // 既存の返信をローカルへ取り込み、試行回数を戻します。
        // こうすることで同じレビューを毎回チェックし続けずに済みます。
        await syncRemoteReply(admin, review.id, userId, remoteReply);
        if (attemptsSupported) {
          await resetAutoReplyAttempts(admin, review.id, userId);
        }

        await releaseReviewClaim(review.id, userId);
        skipped += 1;
        continue;
      }

      try {
        await withValidAccessToken(connection, (token) =>
          replyToReview(review.external_id, replyText, token)
        );
      } catch (error) {
        // 401（アクセスの失効）なら接続は失効扱いになるので、
        // この店舗以降のレビューは処理しません。
        if (isRevokedAccessError(error)) {
          revokedLocations.add(locationId);
        }
        throw error;
      }

      // ここからは「Googleへの投稿は成功している」状態です。
      // 記録に失敗しても投稿の成功は握りつぶさず、ログに明确的に残します。
      let recordError: unknown = null;
      try {
        await recordReply({
          reviewId: review.id,
          userId,
          replyText,
          autoReplied: true,
        });
      } catch (error) {
        recordError = error;
      }

      // recordReply は失敗しても例外を投げずにログだけを残すため、
      // 読み直して記録が反映されたかを自分で確認します。
      const recorded = await isReplyRecorded(admin, review.id, userId);
      if (recordError || !recorded) {
        console.error(
          "CRITICAL: Googleへの投稿は成功しましたが、返信の記録に失敗しました。" +
            "次回実行で別の文が再投稿される恐れがあります。" +
            `（レビューID: ${review.id}、店舗ID: ${review.location_id ?? "不明"}）`,
          {
            reviewId: review.id,
            externalId: review.external_id,
            recorded,
            error: recordError,
          }
        );
      } else if (attemptsSupported) {
        // 記録できたので、試行回数を元に戻します
        await resetAutoReplyAttempts(admin, review.id, userId);
      }

      replied += 1;
    } catch (error) {
      console.error(
        `レビュー ${review.id} の自動返信に失敗しました` +
          `（店舗ID: ${review.location_id ?? "不明"}）`,
        error
      );
      await releaseReviewClaim(review.id, userId);
      skipped += 1;

      // レビュー固有の失敗（AIの文が日本語でない、レビューが見つからない等）
      // なら試行回数を増やします。繰り返し失敗するレビューが
      // バッチの先頭を永久に占有しないようにするためです。
      // 一時的な障害（429/5xxなど）では回数を増やしません。
      if (attemptsSupported && !isTransientFailure(error)) {
        await incrementAutoReplyAttempts(admin, review.id, userId);
      }
    }
  }

  return { replied, skipped };
}
