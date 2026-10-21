import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listConnections } from "@/lib/google/connections";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!isGoogleConfigured()) {
    redirect("/settings?google=not_configured");
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  // 既にrefresh tokenを持っている場合は同意画面を出さずに再連携できます。
  // （同意画面を毎回出すと、再連携のたびに利用者が止まってしまいます）
  const connections = await listConnections(user.id).catch(() => []);
  const hasRefreshToken = connections.some(
    (connection) =>
      connection.status !== "revoked" && Boolean(connection.refresh_token)
  );

  redirect(buildAuthUrl({ state, forceConsent: !hasRefreshToken }));
}
