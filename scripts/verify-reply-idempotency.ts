/**
 * C2 / C5 の修正をライブDBと実コードで検証する。
 *
 * - GBPのレビュー一覧をスタブし、実際に syncReviews() を走らせる
 * - 「GBPが reviewReply を含まない」場合に既存の返信履歴が保持されることを確認する
 * - 「GBPが reviewReply を含む」場合にGBP側が優先されることを確認する
 * - claimed_at カラム未適用時に claimReviews() が例外を投げずに fail-soft することを確認する
 *
 * 実行: npx tsx scripts/verify-reply-idempotency.ts
 */
import fs from "node:fs";
import { createAdminClient } from "../src/lib/supabase/admin";
import { syncReviews } from "../src/lib/google/reviews";
import { encryptSecret } from "../src/lib/crypto";
import { claimReviews } from "../src/lib/review-claims";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const admin = createAdminClient();

const USER_ID = "612816f9-86d1-49ae-a082-479f023dec23";
const LOCATION_ID = "accounts/verify/locations/verify-location";
const EXTERNAL_ID =
  "accounts/verify/locations/verify-location/reviews/verify-review";

type Result = { name: string; pass: boolean; detail: string };

function check(name: string, pass: boolean, detail = "") {
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`
  );
  return { name, pass, detail };
}

async function main() {
  const results: Result[] = [];

  // ---- GBP APIのスタブ -----------------------------------------------------
  const originalFetch = globalThis.fetch;
  let gbpPayload: unknown = { reviews: [] };

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("https://mybusiness.googleapis.com")) {
      return new Response(JSON.stringify(gbpPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  async function cleanup() {
    await admin.from("reviews").delete().eq("external_id", EXTERNAL_ID);
    await admin.from("gbp_connections").delete().eq("location_id", LOCATION_ID);
  }

  /**
   * レビュー取得は契約中のみ実行されるため、テスト中は契約済みにしておく。
   */
  async function setSubscribed(subscribed: boolean) {
    if (subscribed) {
      await admin
        .from("profiles")
        .upsert(
          { id: USER_ID, subscription_status: "active" },
          { onConflict: "id" }
        );
    } else {
      await admin.from("profiles").delete().eq("id", USER_ID);
    }
  }

  async function seed(replyText: string | null) {
    await admin.from("reviews").upsert(
      {
        user_id: USER_ID,
        location_id: LOCATION_ID,
        external_id: EXTERNAL_ID,
        author_name: "T. 様",
        rating: 2,
        content: "席に案内されるまで30分以上待ちました。",
        published_at: "2026-10-18T00:00:00.000Z",
        reply_text: replyText,
        replied_at: replyText ? "2026-10-18T01:00:00.000Z" : null,
        auto_replied: true,
      },
      { onConflict: "user_id,external_id" }
    );
  }

  async function readReply() {
    const { data } = await admin
      .from("reviews")
      .select("reply_text, replied_at, auto_replied")
      .eq("external_id", EXTERNAL_ID)
      .maybeSingle();
    return data;
  }

  try {
    // レビュー取得は契約中のみ実行されるため、テスト中は契約済みにする
    await setSubscribed(true);

    // ダミーの連携行（有効期限は未来なのでGoogleにはアクセスしない）
    await admin.from("gbp_connections").upsert(
      {
        user_id: USER_ID,
        google_account_id: "accounts/verify",
        google_account_name: "検証用",
        location_id: LOCATION_ID,
        location_title: "検証用店舗",
        access_token: encryptSecret("dummy-access-token"),
        refresh_token: encryptSecret("dummy-refresh-token"),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      { onConflict: "user_id,location_id" }
    );

    // ケース1: GBPが reviewReply を含まない -> 既存の返信履歴を保持する
    await seed("この度はご来店いただき、誠に申し訳ございません。");
    gbpPayload = {
      reviews: [
        {
          name: EXTERNAL_ID,
          reviewer: { displayName: "T. 様" },
          starRating: "TWO",
          comment: "席に案内されるまで30分以上待ちました。",
          createTime: "2026-10-18T00:00:00.000Z",
        },
      ],
    };
    const syncResult = await syncReviews(USER_ID);
    const afterCase1 = await readReply();

    // claimed_at（マイグレーション6）や posted_via（8）が未適用でも、
    // upsertがこれらの列を持たないため同期そのものは失敗しないことを確認する。
    // 列を入れると未適用環境でリクエストごと失敗し、「未返信」と誤判定される。
    results.push(
      check(
        "C2: マイグレーション未適用でも同期が失敗しない",
        syncResult.failures.length === 0 && syncResult.imported >= 1,
        `imported=${syncResult.imported} failures=${JSON.stringify(
          syncResult.failures
        )}`
      )
    );

    results.push(
      check(
        "C2: GBPがreviewReplyを含まない場合、既存のreply_textが保持される",
        afterCase1?.reply_text === "この度はご来店いただき、誠に申し訳ございません。",
        `reply_text=${JSON.stringify(afterCase1?.reply_text)}`
      )
    );
    results.push(
      check(
        "C2: replied_atも同時に保持される",
        afterCase1?.replied_at != null &&
          new Date(afterCase1.replied_at).toISOString() ===
            "2026-10-18T01:00:00.000Z",
        `replied_at=${afterCase1?.replied_at}`
      )
    );
    results.push(
      check(
        "C2: auto_repliedフラグが失われない",
        afterCase1?.auto_replied === true,
        `auto_replied=${afterCase1?.auto_replied}`
      )
    );

    // ケース2: GBPが reviewReply を含む -> GBP側が優先される
    gbpPayload = {
      reviews: [
        {
          name: EXTERNAL_ID,
          reviewer: { displayName: "T. 様" },
          starRating: "TWO",
          comment: "席に案内されるまで30分以上待ちました。",
          createTime: "2026-10-18T00:00:00.000Z",
          reviewReply: {
            comment: "Google側で編集された返信",
            updateTime: "2026-10-19T00:00:00.000Z",
          },
        },
      ],
    };
    await syncReviews(USER_ID);
    const afterCase2 = await readReply();
    results.push(
      check(
        "C2: GBPにreviewReplyがあればGBP側の値が採用される",
        afterCase2?.reply_text === "Google側で編集された返信",
        `reply_text=${JSON.stringify(afterCase2?.reply_text)}`
      )
    );

    // ケース3: 未返信のレビューは null のまま
    await admin.from("reviews").delete().eq("external_id", EXTERNAL_ID);
    gbpPayload = {
      reviews: [
        {
          name: EXTERNAL_ID,
          reviewer: { displayName: "T. 様" },
          starRating: "TWO",
          comment: "席に案内されるまで30分以上待ちました。",
          createTime: "2026-10-18T00:00:00.000Z",
        },
      ],
    };
    await syncReviews(USER_ID);
    const afterCase3 = await readReply();
    results.push(
      check(
        "C2: 未返信レビューのreply_textはnullのまま",
        afterCase3?.reply_text === null,
        `reply_text=${JSON.stringify(afterCase3?.reply_text)}`
      )
    );

    // ケース4: claimed_at未適用でも claimReviews は例外を投げない
    let claimError: unknown = null;
    let claimed: string[] = [];
    try {
      const { data } = await admin
        .from("reviews")
        .select("id")
        .eq("external_id", EXTERNAL_ID)
        .maybeSingle();
      claimed = await claimReviews(USER_ID, data ? [data.id] : []);
    } catch (error) {
      claimError = error;
    }
    results.push(
      check(
        "C5: claimed_at未適用でもclaimReviewsが例外を投げずにfail-softする",
        claimError === null && claimed.length === 1,
        `error=${claimError ? String(claimError) : "none"} claimed=${claimed.length}`
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
    await setSubscribed(false);
    console.log("\n--- テストデータを削除しました ---");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log("FAILED:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
