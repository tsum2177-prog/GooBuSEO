import { GoogleApiError, isRetryableStatus } from "@/lib/google/api-error";

const API_BASE = "https://mybusiness.googleapis.com/v4";

export type GoogleReview = {
  name: string;
  reviewer?: {
    displayName?: string;
    isAnonymous?: boolean;
  };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: {
    comment?: string;
    updateTime?: string;
  };
};

export type GoogleAccount = {
  name: string;
  accountName?: string;
};

export type GoogleLocation = {
  name: string;
  title?: string;
  primaryCategory?: {
    name?: string;
    displayName?: string;
  };
};

const MAX_PAGE_SIZE = 100;

/**
 * 1店舗から取得するレビューの上限です。
 *
 * `orderBy=updateTime desc` で新しい順に取得しただけでは、
 * 50件を超えた古いレビューは恒久的に取得できません。
 * ただし際限なくページングすると API コストとメモリが跳ね上がるため、
 * 上限を設けて「直近のレビュー」を確実に取得できる状態を保ちます。
 */
const MAX_REVIEWS_PER_LOCATION = 200;

/** Google API へのリクエストのタイムアウト（ミリ秒）です。 */
const REQUEST_TIMEOUT_MS = 15_000;

/** 最大リトライ回数（最初のリクエストは含まない）です。 */
const MAX_RETRIES = 3;

/** 指数バックオフの基準時間（ミリ秒）です。500ms → 1000ms → 2000ms と伸びます。 */
const BASE_BACKOFF_MS = 500;

/** Retry-After ヘッダで待機する場合の上限（ミリ秒）です。 */
const MAX_RETRY_AFTER_MS = 30_000;

function buildPageParams(pageToken?: string): string {
  const params = new URLSearchParams({ pageSize: String(MAX_PAGE_SIZE) });
  if (pageToken) params.set("pageToken", pageToken);
  return params.toString();
}

/**
 * レビュー一覧のクエリ文字列を組み立てます。
 *
 * `orderBy` は空白を含むため、`URLSearchParams`（空白が `+` になる）ではなく
 * `encodeURIComponent` を使って空白を `%20` に変換します。
 */
function buildReviewsQuery(pageToken?: string): string {
  const params = [
    `pageSize=${MAX_PAGE_SIZE}`,
    `orderBy=${encodeURIComponent("updateTime desc")}`,
  ];
  if (pageToken) params.push(`pageToken=${encodeURIComponent(pageToken)}`);
  return params.join("&");
}

/**
 * 指定ミリ秒だけ待機します（バックオフ用）。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数バックオフの待機時間を求めます（500ms → 1000ms → 2000ms）。
 */
function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

/**
 * `Retry-After` ヘッダから待機時間（ミリ秒）を求めます。
 *
 * 秒数指定と HTTP 日時の両方に対応し、解釈できない場合は null を返します。
 * サーバーが长时间の待機を指示しても Worker が止まらないよう上限を設けます。
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }

  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  }

  return null;
}

/**
 * タイムアウト（AbortSignal.timeout）による中断かどうかを判定します。
 */
function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * エラー内容をログ向けの文字列にします。
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * fetch の失敗（タイムアウト・ネットワーク断）を GoogleApiError に変換します。
 *
 * HTTP 応答が返ってきた場合は呼び出し側で `Google APIエラー（<status>）` として
 * 投げるため、ここでは応答なしのエラーのみを取り扱います。
 */
function toGoogleApiError(error: unknown): GoogleApiError {
  if (error instanceof GoogleApiError) return error;
  if (isTimeoutError(error)) {
    return new GoogleApiError(
      `Google APIエラー（408）：リクエストがタイムアウトしました（${REQUEST_TIMEOUT_MS}ms）`,
      408
    );
  }
  // HTTP 応答を受け取れなかったため、ステータスは 0（応答なし）として扱います。
  return new GoogleApiError(
    `Google APIエラー（0）：${describeError(error)}`,
    0
  );
}

/**
 * リクエストごとのタイムアウトを設定します。
 *
 * `AbortSignal.timeout` は Node 18 以降と Cloudflare Workers の両方で使えるため、
 * どちらの実行環境でも同じ書き方でタイムアウトを効かせられます。
 */
function buildRequestSignal(existing?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!existing) return timeoutSignal;
  // 呼び出し側から signal が渡された場合は、両方をまとめて中止できるようにします。
  // AbortSignal.any は比較的新しいランタイムしか持たないため、使える場合だけ合成します。
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([existing, timeoutSignal]);
  }
  return timeoutSignal;
}

/**
 * Google Business Profile API を呼び出します。
 *
 * - リクエストごとに {@link REQUEST_TIMEOUT_MS} でタイムアウトさせます。
 * - 429（クォータ超過）と 5xx は `isRetryableStatus` の判定に従い、
 *   最大 {@link MAX_RETRIES} 回まで指数バックオフして再試行します。
 * - 429 の場合は `Retry-After` ヘッダを優先し、無ければバックオフ時間を待ちます。
 * - 401（トークン失効）は再試行しても直らないため、再試行しません。
 * - 最終的な失敗は {@link GoogleApiError} として投げます。
 */
async function googleFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  let attempt = 0;

  for (;;) {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
        signal: buildRequestSignal(init?.signal),
      });
    } catch (error) {
      // タイムアウトやネットワーク断は一時的な障害なので、余裕があれば再試行します。
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        const waitMs = backoffMs(attempt);
        console.warn(
          `Google APIへの接続に失敗しました（${describeError(error)}）。` +
            `${attempt}/${MAX_RETRIES} 回目に再試行します（${waitMs}ms 待機）。`
        );
        await sleep(waitMs);
        continue;
      }
      throw toGoogleApiError(error);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      attempt += 1;
      const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
      const waitMs = retryAfterMs ?? backoffMs(attempt);
      console.warn(
        `Google APIエラー（${response.status}）が発生しました。` +
          `${attempt}/${MAX_RETRIES} 回目に再試行します（${waitMs}ms 待機）。`
      );
      await sleep(waitMs);
      continue;
    }

    // 401 など再試行しても直らないエラーは、そのまま呼び出し側へ伝えます。
    throw new GoogleApiError(
      `Google APIエラー（${response.status}）`,
      response.status
    );
  }
}

export async function listAccounts(
  accessToken: string
): Promise<GoogleAccount[]> {
  const accounts: GoogleAccount[] = [];
  let pageToken: string | undefined;

  do {
    const data = await googleFetch<{
      accounts?: GoogleAccount[];
      nextPageToken?: string;
    }>(`/accounts?${buildPageParams(pageToken)}`, accessToken);

    accounts.push(...(data.accounts ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return accounts;
}

export async function listLocations(
  accountName: string,
  accessToken: string
): Promise<GoogleLocation[]> {
  const locations: GoogleLocation[] = [];
  let pageToken: string | undefined;

  // Googleのデフォルトは1リクエストあたり約10件なので、
  // 取りこぼさないよう nextPageToken が無くなるまで回します。
  do {
    const data = await googleFetch<{
      locations?: GoogleLocation[];
      nextPageToken?: string;
    }>(
      `/${accountName}/locations?${buildPageParams(pageToken)}`,
      accessToken
    );

    locations.push(...(data.locations ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return locations;
}

/**
 * 1店舗分のレビューを全ページ取得します。
 *
 * 以前は `pageSize=50` の1ページ目しか取得しておらず、50件を超えた古いレビューは
 * 恒久的に取得できませんでした。`nextPageToken` を回して最後まで取得します。
 *
 * 保護として、以下のガードを入れています。
 * - 同じ `nextPageToken` が返ってきた場合は打ち切る（無限ループの防止）。
 * - 1店舗あたり {@link MAX_REVIEWS_PER_LOCATION} 件で打ち切り、警告ログを残します。
 */
export async function listReviews(
  locationName: string,
  accessToken: string
): Promise<GoogleReview[]> {
  const reviews: GoogleReview[] = [];
  // すでに送ったページトークンを記録し、同じトークンの再配信を検出します。
  const usedTokens = new Set<string>();
  let pageToken: string | undefined;

  do {
    const data = await googleFetch<{
      reviews?: GoogleReview[];
      nextPageToken?: string;
    }>(`/${locationName}/reviews?${buildReviewsQuery(pageToken)}`, accessToken);

    let reachedLimit = false;
    for (const review of data.reviews ?? []) {
      if (reviews.length >= MAX_REVIEWS_PER_LOCATION) {
        reachedLimit = true;
        break;
      }
      reviews.push(review);
    }

    if (reachedLimit) {
      console.warn(
        `レビューの取得上限（${MAX_REVIEWS_PER_LOCATION}件）に到達したため、` +
          `古いレビューは取得していません`,
        { locationName }
      );
      break;
    }

    const nextToken = data.nextPageToken;
    if (!nextToken) break;

    if (usedTokens.has(nextToken)) {
      // Googleが異常なトークンを返した場合、そのまま回すと無限ループになります。
      console.warn(
        "同じ nextPageToken が返ってきたため、レビューの取得を打ち切ります",
        { locationName, nextToken }
      );
      break;
    }

    usedTokens.add(nextToken);
    pageToken = nextToken;
  } while (pageToken);

  return reviews;
}

/**
 * レビューに既に付いている返信を取得します。
 * 投稿する前に、店主がGoogleマップ上で直接返信していないかを確認するために使います。
 */
export async function getReviewReply(
  reviewName: string,
  accessToken: string
): Promise<{ comment?: string; updateTime?: string } | null> {
  const data = await googleFetch<{
    reviewReply?: { comment?: string; updateTime?: string };
  }>(`/${reviewName}/reply`, accessToken);
  return data.reviewReply ?? null;
}

export async function replyToReview(
  reviewName: string,
  comment: string,
  accessToken: string
): Promise<void> {
  await googleFetch<unknown>(`/${reviewName}/reply`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ comment }),
  });
}

const starRatings: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export function toStarRating(starRating?: string): number {
  if (!starRating) return 0;
  return starRatings[starRating] ?? 0;
}
