/**
 * auth.users への insert 時に profiles 行が自動作成されるか（handle_new_user トリガー）を検証する。
 * 実行: npx tsx scripts/verify-signup-trigger.ts
 */
import fs from "node:fs";
import { createAdminClient } from "../src/lib/supabase/admin";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const admin = createAdminClient();
const email = `trigger-check-${Date.now()}@example.com`;

async function main() {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) {
    console.log("createUser error:", error.message);
    process.exit(1);
  }
  const userId = data.user!.id;
  console.log(`created user: ${userId}`);

  try {
    const { data: profile, error: readError } = await admin
      .from("profiles")
      .select("id, email, subscription_status")
      .eq("id", userId)
      .maybeSingle();

    if (readError) {
      console.log("read error:", readError.message);
    } else if (!profile) {
      console.log(
        "RESULT: profiles 行が作成されていません（handle_new_user トリガーが発火していない）"
      );
    } else {
      console.log(
        `RESULT: profiles 行が作成されました -> ${JSON.stringify(profile)}`
      );
    }
  } finally {
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    console.log(
      deleteError
        ? `テストユーザー削除に失敗: ${deleteError.message}`
        : "テストユーザーを削除しました"
    );
    await admin.from("profiles").delete().eq("id", userId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
