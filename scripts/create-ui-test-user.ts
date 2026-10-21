/**
 * UI検証用のテストユーザーを作成する（pw検証後に削除する）。
 * 実行: npx tsx scripts/create-ui-test-user.ts <email> <password>
 */
import fs from "node:fs";
import { createAdminClient } from "../src/lib/supabase/admin";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("usage: tsx scripts/create-ui-test-user.ts <email> <password>");
  process.exit(1);
}

const admin = createAdminClient();

async function main() {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    console.error("createUser error:", error.message);
    process.exit(1);
  }

  console.log(data.user!.id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
