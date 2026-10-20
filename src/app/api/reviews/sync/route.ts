import { NextResponse } from "next/server";
import { autoReplyPendingReviews } from "@/lib/google/auto-reply";
import { syncReviews } from "@/lib/google/reviews";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleSync(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections } = await admin
    .from("gbp_connections")
    .select("user_id");

  const userIds = [
    ...new Set((connections ?? []).map((connection) => connection.user_id)),
  ];

  let imported = 0;
  let replied = 0;

  for (const userId of userIds) {
    try {
      const result = await syncReviews(userId);
      imported += result.imported;

      const auto = await autoReplyPendingReviews(userId);
      replied += auto.replied;
    } catch (error) {
      console.error("sync failed for user", userId, error);
    }
  }

  return NextResponse.json({
    ok: true,
    users: userIds.length,
    imported,
    replied,
  });
}

export async function GET(request: Request) {
  return handleSync(request);
}

export async function POST(request: Request) {
  return handleSync(request);
}
