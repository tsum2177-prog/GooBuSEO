import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** service_role のクライアント */
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * claimが取り残された場合の回収しきい値。
 *
 * 1回の実行で対象になるのは1ユーザーあたり最大 AUTO_REPLY_BATCH_SIZE（20件）で、
 * 各レビューについて「AIの返信生成」と「Googleマップへの投稿・返信確認」の
 * API呼び出しが1件ずつ発生します。1件あたり数十秒ほどかかるため、
 * 1バッチの所要時間は10分を超える可能性があります。
 *
 * 10分だと、処理がまだ続いていても別の実行からclaimを奪われてしまう。
 * 1バッチの想定所要時間を十分上回る30分を採用して、
 * 実行中の処理が他の実行に奪われないようにしています。
 */
const CLAIM_TIMEOUT_MS = 30 * 60 * 1000;

/** claimに使うカラム名 */
const CLAIM_COLUMN_NAMES = ["claimed_at", "claimed_by"] as const;

/**
 * 「指定したカラムがDBに存在しない」種類のエラーかどうかを判定します。
 *
 * 判定は「メッセージ」と「エラーコード」の2つを組み合わせて行います。
 *
 * 1) メッセージからの判定
 *    Supabase/PostgRESTのエラーは `code` / `message` / `details` / `hint` を持ちます。
 *    メッセージ・詳細・ヒントをまとめて1つの文字列にし、
 *    そこに指定したカラム名の語が含まれているかを見ます。
 *    今回追加する列なので、「この列が無い」と言われているなら
 *    マイグレーション未適用と読めます。
 *
 * 2) 「列が無い」を示すシグナルとの組み合わせ
 *    カラム名に加えて、次のどちらかが揃っているときに「列未適用」と判定します。
 *    - エラーコードが `PGRST204`（PostgRESTのスキーマキャッシュに列が無い）
 *      または `42703`（PostgreSQLの undefined_column）
 *    - メッセージに「列が無い」を示す語が含まれる
 *      （does not exist / not found / schema cache / 存在しません）
 *
 * 一時エラー（接続断、タイムアウト、PGRST000/001/003、権限エラーなど）は
 * 上の判定に引っかからないため、縮退ではなく例外で処理を中止します。
 */
function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (typeof error !== "object" || error === null) return false;

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const parts: string[] = [];
  for (const key of ["message", "details", "hint"]) {
    const value = record[key];
    if (typeof value === "string") parts.push(value);
  }
  const text = parts.join(" ");

  if (!text.includes(columnName)) return false;

  const codeMeansMissingColumn = code === "PGRST204" || code === "42703";
  const messageMeansMissingColumn =
    /does not exist|not found|schema cache|存在しません/i.test(text);

  return codeMeansMissingColumn || messageMeansMissingColumn;
}

/**
 * 「claimに使うカラムがDBに存在しない」種類のエラーかどうかを判定します。
 *
 * `claimed_at` と `claimed_by` のどちらかが欠けているときに真になります。
 */
function isMissingClaimColumnError(error: unknown): boolean {
  return CLAIM_COLUMN_NAMES.some((name) => isMissingColumnError(error, name));
}

/**
 * 「`claimed_by` カラムがDBに存在しない」種類のエラーかどうかを判定します。
 *
 * `claimed_by` は後から追加するカラムなので、新しく追加したマイグレーション
 * （`20261021120000_add_claimed_by.sql`）が未適用の環境では
 * このカラムだけが欠けます。`claimed_at` による排他を保つために、
 * この場合だけ `claimed_at` のみのクエリへフォールバックします。
 */
function isMissingClaimedByColumnError(error: unknown): boolean {
  return isMissingColumnError(error, "claimed_by");
}

/**
 * エラーの内容を、ログに載せるための文字列にまとめます。
 * 原因を断定せず、実際に返ってきたエラーだけを載せます。
 */
function describeError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";

  return [code, message, details].filter((value) => value.length > 0).join(" / ");
}

/**
 * この実行固有のclaim所有者IDを生成します。
 * 呼び出しごとに一意なので、別の実行と区別できます。
 */
function createClaimOwnerId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 1行のclaimを解放するクエリを作ります。
 * userId を渡すと、解放対象をそのユーザーのレビューに限定します。
 */
function buildReleaseQuery(
  admin: AdminClient,
  reviewId: string,
  userId: string | undefined,
  payload: { claimed_at: null; claimed_by?: null }
) {
  let query = admin.from("reviews").update(payload).eq("id", reviewId);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  return query;
}

/**
 * 取り残されたclaimを解放します。
 *
 * 解放は `claimed_at` と `claimed_by` をまとめて行います。
 * `claimed_by` 列が未適用の環境（マイグレーション `20261021120000_add_claimed_by.sql`
 * の未適用）ではこのクエリが失敗するため、`claimed_at` のみの解放にフォールバックします。
 * 排他制御は `claimed_at` だけで成立するため、縮退しても二重投稿の危険は増えません。
 * （自分が今回確保した行は `claimed_at` が新しいので、解放対象になりません）
 *
 * 一時エラー（接続断、タイムアウト、権限エラーなど）で失敗した場合は、
 * 縮退せずに例外を投げて処理を中止します。
 *
 * @returns 排他制御を使えるなら true、`claimed_at` も存在しないなら false
 */
async function releaseStaleClaims(
  admin: AdminClient,
  userId: string,
  ownerId: string,
  staleBefore: string
): Promise<boolean> {
  const { error: releaseError } = await admin
    .from("reviews")
    .update({ claimed_at: null, claimed_by: null })
    .eq("user_id", userId)
    .is("reply_text", null)
    .lt("claimed_at", staleBefore)
    .or(`claimed_by.is.null,claimed_by.neq.${ownerId}`);

  if (!releaseError) return true;

  if (isMissingClaimedByColumnError(releaseError)) {
    // `claimed_by` 列が未適用のため、`claimed_at` のみで解放し直します
    console.warn(
      "排他制御: `claimed_by` 列が未適用のため `claimed_at` のみで解放しています",
      releaseError
    );

    const { error: fallbackError } = await admin
      .from("reviews")
      .update({ claimed_at: null })
      .eq("user_id", userId)
      .is("reply_text", null)
      .lt("claimed_at", staleBefore);

    if (!fallbackError) return true;

    if (!isMissingClaimColumnError(fallbackError)) {
      throw new Error(
        "排他制御: 取り残されたclaimの解放に失敗したため処理を中止します: " +
          describeError(fallbackError)
      );
    }

    // `claimed_at` も無い環境なので、排他制御を諦めます
    return false;
  }

  if (isMissingClaimColumnError(releaseError)) {
    // claim列が未適用なら、claim処理全体をスキップして縮退動作に入る
    console.warn(
      "排他制御: claimed_at / claimed_by 列がDBに存在しないため、" +
        "排他制御が働かない状態で続行します",
      releaseError
    );
    return false;
  }

  throw new Error(
    "排他制御: 取り残されたclaimの解放に失敗したため処理を中止します: " +
      describeError(releaseError)
  );
}

/**
 * 返信が未着のレビューを排他的に確保し、確保できたIDを返します。
 *
 * `claimed_by` 列が未適用の環境（マイグレーション `20261021120000_add_claimed_by.sql`
 * の未適用）では `claimed_by` を書き込めないため、`claimed_at` のみを
 * 書き込む条件付きUPDATEにフォールバックします。
 * 条件付きUPDATEなので、排他は `claimed_at` だけで成立します。
 *
 * @returns 確保できたID。排他制御がまったく使えない環境（列が無い）では null
 */
async function claimReviewRows(
  admin: AdminClient,
  userId: string,
  reviewIds: string[],
  claimedAt: string,
  ownerId: string
): Promise<string[] | null> {
  const { data, error } = await admin
    .from("reviews")
    .update({ claimed_at: claimedAt, claimed_by: ownerId })
    .in("id", reviewIds)
    .eq("user_id", userId)
    .is("reply_text", null)
    .is("claimed_at", null)
    .select("id");

  if (!error) {
    return (data ?? []).map((row) => row.id);
  }

  if (isMissingClaimedByColumnError(error)) {
    // `claimed_by` 列が未適用のため、`claimed_at` のみで確保し直します
    console.warn(
      "排他制御: `claimed_by` 列が未適用のため `claimed_at` のみで排他を確保しています",
      error
    );

    const fallback = await admin
      .from("reviews")
      .update({ claimed_at: claimedAt })
      .in("id", reviewIds)
      .eq("user_id", userId)
      .is("reply_text", null)
      .is("claimed_at", null)
      .select("id");

    if (!fallback.error) {
      return (fallback.data ?? []).map((row) => row.id);
    }

    if (!isMissingClaimColumnError(fallback.error)) {
      throw new Error(
        "排他制御: 排他の確保に失敗したため処理を中止します: " +
          describeError(fallback.error)
      );
    }
  } else if (!isMissingClaimColumnError(error)) {
    // 一時エラー（接続断、タイムアウト、権限エラーなど）なので縮退せず中断します
    throw new Error(
      "排他制御: 排他の確保に失敗したため処理を中止します: " +
        describeError(error)
    );
  }

  // claim列が未適用なら、claim処理全体をスキップして縮退動作に入る
  console.warn(
    "排他制御: claimed_at / claimed_by 列がDBに存在しないため、" +
      "排他制御が働かない状態で続行します",
    error
  );
  return null;
}

/**
 * 返信が未着のレビューを排他的に確保し、確保できたIDを返します。
 *
 * 条件付きUPDATEなので、cronと手動操作が同時に走っても
 * 同じ行を確保できるのは一方だけになります。
 *
 * 確保した行には `claimed_by`（この実行固有のID）を記録し、
 * 取り残されたclaimを解放するときも「自分が今回確保した行」は
 * 解放対象から外します。
 *
 * エラー時の扱い:
 * - `claimed_by` がDBに存在しないとき（`20261021120000_add_claimed_by.sql` の未適用）は、
 *   `claimed_at` のみのクエリにフォールバックします。
 *   排他は `claimed_at` だけで成立するため、縮退しても二重投稿の危険は増えません。
 * - `claimed_at` もDBに存在しないとき（マイグレーション未適用）は、
 *   claim処理全体をスキップして排他なしの縮退動作で処理を続行します
 *   （自動返信が動かなくなるより、二重投稿の危険が残るほうが望ましいため）。
 *   ただしこの縮退中は排他制御が働かないため、ログに明記します。
 * - それ以外（一時的なDBエラー、タイムアウト、権限エラーなど）は
 *   例外を投げて処理を中止します。排他が失効したまま投稿するほうが
 *   二重投稿の危険が高いためです。
 *
 * `claimed_at` カラムはマイグレーション `20261020120400_add_claim_and_preserve_reply.sql`、
 * `claimed_by` カラムは `20261021120000_add_claimed_by.sql` で追加します。
 */
export async function claimReviews(
  userId: string,
  reviewIds: string[]
): Promise<string[]> {
  if (reviewIds.length === 0) return [];

  const admin = createAdminClient();
  const ownerId = createClaimOwnerId();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();

  // 前回の実行が中断されて取り残されたclaimを解放する。
  // 自分が今回確保した行は解放しない（持ち主不明の行は通常どおり解放する）。
  const released = await releaseStaleClaims(admin, userId, ownerId, staleBefore);
  if (!released) {
    // claim列が無い環境では、claim処理全体をスキップして縮退動作に入る
    return reviewIds;
  }

  const claimed = await claimReviewRows(
    admin,
    userId,
    reviewIds,
    now.toISOString(),
    ownerId
  );
  if (!claimed) {
    // claim列が無い環境では、claim処理全体をスキップして縮退動作に入る
    return reviewIds;
  }

  return claimed;
}

/**
 * 処理に失敗したレビューのclaimを解放し、次の実行で再試行できるようにします。
 *
 * userId を渡すと、解放対象をそのユーザーのレビューに限定します。
 * service_role はRLSを迂回するため、テナント境界はクエリで守ります。
 * 既存の呼び出し（引数1つ）はそのまま動作します。
 */
export async function releaseReviewClaim(
  reviewId: string,
  userId?: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await buildReleaseQuery(admin, reviewId, userId, {
    claimed_at: null,
    claimed_by: null,
  });

  if (!error) return;

  if (isMissingClaimColumnError(error)) {
    // claimed_by が未適用の環境では、claimed_at だけを解放し直す
    const { error: fallbackError } = await buildReleaseQuery(
      admin,
      reviewId,
      userId,
      { claimed_at: null }
    );
    if (fallbackError) {
      console.error("排他制御の解放に失敗しました", fallbackError);
    }
    return;
  }

  console.error("排他制御の解放に失敗しました", error);
}
