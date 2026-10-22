/**
 * アプリケーションのベースURL。
 *
 * リクエストヘッダー（Host / X-Forwarded-Proto）から組み立てると、
 * 攻撃者がヘッダーを偽装して決済リダイレクト先やOAuthのredirect_uriを
 * 書き換えられてしまいます。そのため環境変数で固定します。
 */
export function getAppUrl(): string {
  const url = process.env.APP_URL?.trim();
  if (!url) {
    throw new Error(
      "APP_URL が設定されていません。.env.local または Secret に設定してください"
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * APP_URL が未設定のときだけ、リクエストの origin にフォールバックします。
 *
 * リダイレクト先のパスが固定で、ユーザー入力を受け取らない経路でのみ
 * 使います（パスワード再設定リンクなど、パスを動的に組み立てる経路では使わないこと）。
 */
export function getAppUrlOrRequestOrigin(requestUrl: string): string {
  try {
    return getAppUrl();
  } catch {
    console.error("APP_URL が設定されていないため、リクエストの origin にフォールバックします");
    return new URL(requestUrl).origin;
  }
}
