/**
 * auth.users への insert 時に profiles 行が自動作成されるか（handle_new_user トリガー）を検証する。
 *
 * ⚠ このスクリプトは本番DB（Supabase）を書き換えます。
 *   - auth.users に検証用のユーザーを作成し、終了時に削除します
 *   - 作成された profiles 行も終了時に削除します（元の状態は行なしへ戻す）
 *   - 実行には環境変数 ALLOW_LIVE_DB=1 が必要です
 *     （未設定ならデータに一切触れずに非ゼロ終了します）
 *   - 終了時に元の状態へ復元します。復元できない場合は手動で元へ戻す必要があります
 *   - Ctrl+C（INTERRUPT）で中断した場合も復元を試みますが、復元できない場合は
 *     手動で元へ戻す必要があります
 *
 * 実行: ALLOW_LIVE_DB=1 npx tsx scripts/verify-signup-trigger.ts
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

loadLocalEnv();

assertLiveDbAllowed({
  scriptName: "scripts/verify-signup-trigger.ts",
  operations: [
    "auth.users に検証用のユーザーを作成する（終了時に削除する）",
    "検証用ユーザーの profiles 行を削除する（元の状態は行なしへ戻す）",
  ],
});

const admin = createAdminClient();
const email = `trigger-check-${Date.now()}@example.com`;

async function main() {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) {
    console.log("検証用ユーザーの作成に失敗しました:", error.message);
    process.exit(1);
  }
  const userId = data.user!.id;
  console.log(`検証用ユーザーを作成しました: ${userId}`);

  /**
   * 元に戻す処理です。
   *
   * このスクリプトが作るユーザー（とその profiles 行）はスクリプト実行前には
   * 存在しません。よって「元の状態」は auth.users に行が無く、
   * profiles にも行が無い状態です。
   */
  async function cleanup() {
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    console.log(
      deleteError
        ? `テストユーザー削除に失敗: ${deleteError.message}`
        : "テストユーザーを削除しました"
    );
    // profiles 行は「元から無い」状態へ戻します
    await restoreProfile(userId, { existed: false, row: {} });
  }

  // Ctrl+C で中断した場合も、元の状態へ戻すようにします
  registerInterruptRestore(cleanup);

  try {
    // トリガーが profiles 行を作ったかどうかを行の有無で判定します。
    // （subscription_status の値では判定しません）
    const profile = await snapshotProfile(userId);
    console.log(
      profile.existed
        ? `profiles 行が作成されました -> ${JSON.stringify(profile.row)}`
        : "RESULT: profiles 行が作成されていません（handle_new_user トリガーが発火していない）"
    );
  } finally {
    await cleanup();
    console.log("元の状態へ復元しました");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
