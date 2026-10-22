import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAccounts, listLocations } from "@/lib/google/business";
import { saveConnection } from "@/lib/google/connections";
import { syncReviews } from "@/lib/google/reviews";
import {
  exchangeCode,
  getRedirectUri,
  GoogleAuthError,
} from "@/lib/google/oauth";
import { fillShopSettingsFromLocations, type LocationSummary } from "@/lib/shop-settings";
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
    console.warn("[oauth] コールバックが不正です", {
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
    console.error("[oauth] トークンの交換に失敗しました", {
      userId: user.id,
      oauthCode: error instanceof GoogleAuthError ? error.code : undefined,
      error,
    });
    redirect("/settings?google=error");
  }

  if (!tokens.refresh_token) {
    console.warn("[oauth] リフレッシュトークンが返っていません。再同意が必要です", {
      userId: user.id,
    });
    redirect("/settings?google=need_reconsent");
  }

  // 2. 店舗の一覧と保存
  let saved = 0;
  const savedLocations: LocationSummary[] = [];
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
        savedLocations.push({
          title: location.title ?? null,
          primaryCategory: location.primaryCategory ?? null,
        });
        saved += 1;
      }
    }
  } catch (error) {
    console.error("[oauth] 店舗一覧の取得または保存に失敗しました", {
      userId: user.id,
      saved,
      error,
    });
    redirect("/settings?google=error");
  }

  // 3. 店舗名と業種を自動で設定する（店主が設定済みの値は上書きしない）
  await fillShopSettingsFromLocations(user.id, savedLocations);

  // 4. レビューを自動で取得する。戻った画面で「取得する」ボタンを押さずに済む
  try {
    await syncReviews(user.id);
  } catch (error) {
    console.error("[oauth] レビューの初回同期に失敗しました", {
      userId: user.id,
      error,
    });
  }

  redirect(`/dashboard?google=${saved > 0 ? "connected" : "no_location"}`);
}
