import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAccounts, listLocations } from "@/lib/google/business";
import { saveConnection } from "@/lib/google/connections";
import { exchangeCode, getRedirectUri } from "@/lib/google/oauth";
import { getOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

type CallbackResult =
  | "connected"
  | "no_location"
  | "need_reconsent"
  | "error";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("google_oauth_state")?.value;
  cookieStore.delete("google_oauth_state");

  if (oauthError || !code || !state || !savedState || state !== savedState) {
    redirect("/settings?google=error");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const origin = await getOrigin();
  let result: CallbackResult = "error";

  try {
    const tokens = await exchangeCode(code, getRedirectUri(origin));
    if (!tokens.refresh_token) {
      result = "need_reconsent";
    } else {
      const accounts = await listAccounts(tokens.access_token);
      let saved = 0;

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

      result = saved > 0 ? "connected" : "no_location";
    }
  } catch {
    result = "error";
  }

  redirect(`/settings?google=${result}`);
}
