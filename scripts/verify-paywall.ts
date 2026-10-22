/**
 * C1（課金ゲート）をライブDBと実コードで検証する。
 *
 * - 未契約なら review取得・AI返信生成・返信投稿がすべて止まること
 * - 契約中（active）と支払い遅延（past_due）は利用可能であること
 * - 解約済み（canceled）と未契約（none）は利用不可であること
 * - Stripeのサブスクリプション状態のマッピングが正しいこと
 * - getAccessLevel が契約状態とGoogle連携の有無から権限を正しく判定すること
 *
 * ⚠ このスクリプトは本番DB（Supabase）を書き換えます。
 *   - profiles 行の subscription_status を一時的に書き換えます
 *   - 実行には環境変数 ALLOW_LIVE_DB=1 が必要です
 *     （未設定ならデータに一切触れずに非ゼロ終了します）
 *   - 終了時に profiles 行を行全体（email / stripe_customer_id を含む）で
 *     元へ復元します。元に行が存在しなかった場合は、テストで作った行を削除します
 *   - Ctrl+C（INTERRUPT）で中断した場合も復元を試みますが、復元できない場合は
 *     手動で元へ戻す必要があります
 *
 * 実行: ALLOW_LIVE_DB=1 npx tsx scripts/verify-paywall.ts
 */
// live-guard は src/lib より先に読み込みます（server-only マーカーを無効化するため）
import {
  assertLiveDbAllowed,
  loadLocalEnv,
  registerInterruptRestore,
  restoreProfile,
  snapshotProfile,
} from "./lib/live-guard";
import { createAdminClient } from "../src/lib/supabase/admin";
import {
  FREE_MAX_LOCATIONS,
  getAccessLevel,
  getSubscriptionStatus,
  isAccessibleStatus,
  isSubscribed,
  mapStripeSubscriptionStatus,
  parseSubscriptionStatus,
} from "../src/lib/billing";
import { syncReviews } from "../src/lib/google/reviews";
import { autoReplyPendingReviews } from "../src/lib/google/auto-reply";
import { hasActiveConnection } from "../src/lib/google/connections";

loadLocalEnv();

assertLiveDbAllowed({
  scriptName: "scripts/verify-paywall.ts",
  operations: [
    "profiles 行の subscription_status を一時的に書き換える（終了時に元へ戻す）",
    "それ以外のテーブルは読み取りのみ",
  ],
});

const admin = createAdminClient();
const USER_ID = "612816f9-86d1-49ae-a082-479f023dec23";

type Result = { name: string; pass: boolean };
const results: Result[] = [];

function check(name: string, pass: boolean, detail = ""): boolean {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
  return pass;
}

async function setStatus(status: string) {
  // profiles 行が存在しない場合もあるので upsert を使う。
  // subscription_status だけを書き換えるので、他の列（email など）は失われません。
  await admin
    .from("profiles")
    .upsert({ id: USER_ID, subscription_status: status }, { onConflict: "id" });
}

async function main() {
  // 元の profiles 行を行全体で保存しておく（終了時に元へ戻す）
  const originalProfile = await snapshotProfile(USER_ID);
  console.log(
    originalProfile.existed
      ? `元の profiles 行を保存しました: subscription_status=${String(
          originalProfile.row.subscription_status ?? "NULL"
        )}`
      : "元の profiles 行は存在しません（終了時にテストで作った行を削除します）\n"
  );

  // Ctrl+C で中断した場合も、元の状態へ戻すようにします
  registerInterruptRestore(async () => {
    await restoreProfile(USER_ID, originalProfile);
  });

  try {
    // --- 1. 状態マッピング ---------------------------------------------
    check(
      "active は利用可能",
      isAccessibleStatus(parseSubscriptionStatus("active")) === true
    );
    check(
      "past_due は猶予として利用可能",
      isAccessibleStatus(parseSubscriptionStatus("past_due")) === true
    );
    check(
      "canceled は利用不可",
      isAccessibleStatus(parseSubscriptionStatus("canceled")) === false
    );
    check(
      "none は利用不可",
      isAccessibleStatus(parseSubscriptionStatus("none")) === false
    );
    check(
      "未知の値は none として扱う",
      parseSubscriptionStatus("whatever") === "none" &&
        parseSubscriptionStatus(null) === "none" &&
        parseSubscriptionStatus(undefined) === "none"
    );

    // --- 2. Stripeの状態マッピング ---------------------------------------
    check(
      "Stripe active -> active",
      mapStripeSubscriptionStatus("active") === "active"
    );
    check(
      "Stripe trialing -> active",
      mapStripeSubscriptionStatus("trialing") === "active"
    );
    check(
      "Stripe past_due -> past_due",
      mapStripeSubscriptionStatus("past_due") === "past_due"
    );
    check(
      "Stripe unpaid -> past_due",
      mapStripeSubscriptionStatus("unpaid") === "past_due"
    );
    check(
      "Stripe paused -> past_due（契約は継続しているため利用は許す）",
      mapStripeSubscriptionStatus("paused") === "past_due"
    );
    check(
      "Stripe canceled -> canceled",
      mapStripeSubscriptionStatus("canceled") === "canceled"
    );
    check(
      "Stripe incomplete -> none（初回支払いが未完了）",
      mapStripeSubscriptionStatus("incomplete") === "none"
    );
    check(
      "Stripe incomplete_expired -> canceled",
      mapStripeSubscriptionStatus("incomplete_expired") === "canceled"
    );

    // --- 3. 未契約なら投稿・自動返信が止まる -----------------------------
    const connected = await hasActiveConnection(USER_ID);

    await setStatus("none");
    check(
      "未契約: isSubscribed が false",
      (await isSubscribed(USER_ID)) === false
    );
    check(
      "未契約: getSubscriptionStatus が none",
      (await getSubscriptionStatus(USER_ID)) === "none"
    );

    const synced = await syncReviews(USER_ID);
    check(
      "未契約: 取得はGoogle連携があるときだけ（最大1店舗）",
      connected
        ? synced.locations <= FREE_MAX_LOCATIONS
        : synced.imported === 0 && synced.locations === 0,
      `imported=${synced.imported} locations=${synced.locations} connected=${connected}`
    );

    const auto = await autoReplyPendingReviews(USER_ID);
    check(
      "未契約: autoReplyPendingReviews が返信しない",
      auto.replied === 0 && auto.skipped === 0,
      `replied=${auto.replied} skipped=${auto.skipped}`
    );

    // --- 4. 契約中なら通過する -------------------------------------------
    await setStatus("active");
    check(
      "契約中: isSubscribed が true",
      (await isSubscribed(USER_ID)) === true
    );
    check(
      "契約中: getSubscriptionStatus が active",
      (await getSubscriptionStatus(USER_ID)) === "active"
    );

    await setStatus("past_due");
    check(
      "支払い遅延: isSubscribed が true（猶予）",
      (await isSubscribed(USER_ID)) === true
    );

    await setStatus("canceled");
    check(
      "解約済み: isSubscribed が false",
      (await isSubscribed(USER_ID)) === false
    );

    // --- 5. 権限モデル（getAccessLevel） --------------------------------
    await setStatus("none");
    const freeAccess = await getAccessLevel(USER_ID);
    check(
      "未契約: Googleマップへの投稿は不可",
      freeAccess.canPostReplies === false
    );
    check(
      "未契約: 自動返信は不可",
      freeAccess.canAutoReply === false
    );
    check(
      `未契約: 店舗数は${FREE_MAX_LOCATIONS}件に制限される`,
      freeAccess.maxLocations === FREE_MAX_LOCATIONS
    );
    check(
      "未契約: レビュー取得・下書き生成はGoogle連携の有無で決まる",
      freeAccess.canReadReviews === connected &&
        freeAccess.canGenerateReplies === connected,
      `connected=${connected}`
    );

    await setStatus("active");
    const paidAccess = await getAccessLevel(USER_ID);
    check(
      "契約中: すべての機能が使える",
      paidAccess.canReadReviews === true &&
        paidAccess.canGenerateReplies === true &&
        paidAccess.canPostReplies === true &&
        paidAccess.canAutoReply === true
    );
    check(
      "契約中: 店舗数の上限なし",
      paidAccess.maxLocations === Number.POSITIVE_INFINITY
    );

    // --- 6. 存在しないユーザー -------------------------------------------
    check(
      "未知のユーザー: 未契約として扱う（fail-closed）",
      (await isSubscribed("00000000-0000-0000-0000-000000000000")) === false
    );
  } finally {
    // 元の profiles 行へ必ず戻す。
    // 元に行が無ければ、テストで作った行を削除します。
    await restoreProfile(USER_ID, originalProfile);
    console.log(
      originalProfile.existed
        ? "\n元の profiles 行へ復元しました"
        : "\n元の profiles 行は存在しなかったので、テストで作った行を削除しました"
    );
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
