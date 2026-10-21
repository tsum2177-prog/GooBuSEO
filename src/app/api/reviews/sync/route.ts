import { NextResponse } from "next/server";
import { autoReplyPendingReviews } from "@/lib/google/auto-reply";
import { syncReviews } from "@/lib/google/reviews";
import { selectUsersForRun } from "@/lib/google/sync-batch";
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

  const targets = selectUsersForRun(userIds);

  for (const userId of targets) {
    // 取得と自動返信は独立して処理する。
    // 取得が失敗しても、自動返信の処理は止めない。
    try {
      const result = await syncReviews(userId);
      imported += result.imported;
    } catch (error) {
      console.error("sync failed for user", userId, error);
    }

    try {
      const auto = await autoReplyPendingReviews(userId);
      replied += auto.replied;
    } catch (error) {
      console.error("auto reply failed for user", userId, error);
    }
  }

  return NextResponse.json({
    ok: true,
    totalUsers: userIds.length,
    processedUsers: targets.length,
    imported,
    replied,
  });
}

export async function POST(request: Request) {
  return handleSync(request);
}
