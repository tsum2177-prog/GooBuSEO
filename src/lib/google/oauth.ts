import { getAppUrl } from "@/lib/app-url";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

export function getRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ??
    `${getAppUrl()}/api/google/oauth/callback`
  );
}

export function buildAuthUrl({
  state,
}: {
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

/**
 * GoogleのOAuthエラー。`code` で原因を区別できるようにしています。
 */
export class GoogleAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

/**
 * トークンエンドポイントはエラーをJSONで返します。
 * `invalid_grant` は refresh token が失効（権限解除・失効）していることを示します。
 */
async function readOAuthErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

async function requestToken(
  body: URLSearchParams
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const code = await readOAuthErrorCode(response);
    throw new GoogleAuthError(code, `Googleの認証に失敗しました（${code}）`);
  }

  return (await response.json()) as TokenResponse;
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
  );
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    })
  );
}
