/**
 * Google API の失敗を表すエラー。
 *
 * 文字列にステータスを埋め込むだけだと、呼び出し側が
 * 「再試行すべき429」か「再認証が必要な401」か区別できません。
 */
export class GoogleApiError extends Error {
  /** HTTPステータスコード */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

/**
 * 再試行しても成功しうるステータスかどうか。
 *
 * 429（クォータ超過）と5xx（サーバーエラー）は時間を置いて再試行します。
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
