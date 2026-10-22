import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getAppUrlOrRequestOrigin } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const appUrl = getAppUrlOrRequestOrigin(request.url);
  const supabase = await createClient();

  try {
    if (tokenHash && type && ALLOWED_OTP_TYPES.includes(type as EmailOtpType)) {
      const { error } = await supabase.auth.verifyOtp({
        type: type as EmailOtpType,
        token_hash: tokenHash,
      });
      if (!error) {
        return NextResponse.redirect(new URL("/dashboard", appUrl));
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL("/dashboard", appUrl));
      }
    }
  } catch (error) {
    console.error("メールの確認リンクの処理に失敗しました", error);
  }

  return NextResponse.redirect(new URL("/error?reason=confirm", appUrl));
}
