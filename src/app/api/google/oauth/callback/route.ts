import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAccounts, listLocations } from "@/lib/google/business";
import { saveConnection } from "@/lib/google/connections";
import {
  exchangeCode,
  getRedirectUri,
  GoogleAuthError,
} from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("google_oauth_state")?.value;
  cookieStore.delete("google_oauth_state");

  if (oauthError || !code || !state || !savedState || state !== savedState) {
    // 何が欠けていたかをログに残す（握りつぶすと運用中に原因が分からない）
    console.warn("[oauth] callback rejected", {
      hasOauthError: Boolean(oauthError),
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasSavedState: Boolean(savedState),
    });
    redirect("/settings?google=error");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1. トークン交換
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code, getRedirectUri());
  } catch (error) {
    console.error("[oauth] token exchange failed", {
      userId: user.id,
      oauthCode: error instanceof GoogleAuthError ? error.code : undefined,
      error,
    });
    redirect("/settings?google=error");
  }

  if (!tokens.refresh_token) {
    console.warn("[oauth] no refresh token returned; consent must be given again", {
      userId: user.id,
    });
    redirect("/settings?google=need_reconsent");
  }

  // 2. 店舗の一覧と保存
  let saved = 0;
  try {
    const accounts = await listAccounts(tokens.access_token);
    for (const account of accounts) {
      const locations = await listLocations(account.name, tokens.access_token);
      for (const location of locations) {
        await saveConnection({
          userId: user.id,
          googleAccountId: account.name,
          googleAccountName: account.accountName ?? null,
          locationId: location.name,
          locationTitle: location.title ?? null,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
        });
        saved += 1;
      }
    }
  } catch (error) {
    console.error("[oauth] listing or saving locations failed", {
      userId: user.id,
      saved,
      error,
    });
    redirect("/settings?google=error");
  }

  redirect(`/settings?google=${saved > 0 ? "connected" : "no_location"}`);
}
