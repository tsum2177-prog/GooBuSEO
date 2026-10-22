import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { autoReplyPendingReviews } from "@/lib/google/auto-reply";
import { syncReviews } from "@/lib/google/reviews";
import { selectUsersForRun } from "@/lib/google/sync-batch";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRON_SECRET を取得する。
 *
 * 取得元は worker.ts（cron 側）と 1 系統に揃えている。
 *
 * 1. process.env.CRON_SECRET
 *    - 本番（Cloudflare Workers）: `npx wrangler secret put CRON_SECRET` で登録した
 *      secret binding。Worker ランタイムではこの binding が process.env に注入される
 *      （nodejs_compat の populate_process_env と、OpenNext の populateProcessEnv が
 *      process.env[key] = value で上書きする）ため、process.env を読めば
 *      binding と同じ値が取れる。
 *    - ローカル開発: .env.local / .dev.vars
 * 2. 取得できなかった場合は「未設定」。呼び出しを拒否する（401）。
 *
 * ビルド時に env ファイルがバンドルへ焼き込まれるのを防ぐのは
 * scripts/build-cloudflare.ts の責務。
 */
function getCronSecret(): string | undefined {
  const secret = process.env.CRON_SECRET?.trim();
  return secret ? secret : undefined;
}

/**
 * 定数時間比較で 2 つの文字列が一致するか判定する。
 *
 * timingSafeEqual は長さが違うと例外を投げるため、長さが違う場合は
 * unequal として扱って先に return する。
 */
function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

async function handleSync(request: Request) {
  const secret = getCronSecret();
  const provided = request.headers.get("authorization") ?? "";

  if (!secret || !safeEqual(provided, `Bearer ${secret}`)) {
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
      console.error("レビュー同期に失敗しました", userId, error);
    }

    try {
      const auto = await autoReplyPendingReviews(userId);
      replied += auto.replied;
    } catch (error) {
      console.error("自動返信に失敗しました", userId, error);
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
