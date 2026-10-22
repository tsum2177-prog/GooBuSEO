/**
 * supabase/setup-all.sql を migrations/ から再生成します。
 *
 * migrations/ のファイルをファイル名順（タイムスタンプ順）に連結したものが
 * setup-all.sql です。手作業で両方を編集していると必ず乖離するため、
 * 必ずこのスクリプトで生成してください。
 *
 * 実行: npx tsx scripts/generate-setup-all.ts
 * 確認: npx tsx scripts/generate-setup-all.ts --check
 *        （--check は「生成結果とファイルの内容が一致するか」だけを確認し、
 *          ファイルは書き換えません。CIでの差分検出に使えます）
 */
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "supabase", "setup-all.sql");

const HEADER = `-- ============================================================
-- レビュー返信AI セットアップSQL（Supabase SQL Editor用）
-- migrations/ 以下のファイルを順番に連結したものです。
-- このファイルは手で編集しないでください。
-- scripts/generate-setup-all.ts で再生成してください。
--
-- 使い方: Supabase ダッシュボード > SQL Editor > New query に貼り付けて Run
-- 同じスクリプトは何度実行してもエラーになりません（drop policy if exists / create table if not exists を使用）。
-- ============================================================
`;

/**
 * 末尾の確認用クエリ。
 *
 * 個別のマイグレーション末尾の「実行結果の確認」は、連結時に重複するため
 * ここでは1つにまとめます。
 */
const FOOTER = `-- ============================================================
-- 実行結果の確認
-- ============================================================
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles',
    'shop_settings',
    'reviews',
    'gbp_connections',
    'stripe_events'
  )
order by table_name, column_name;

-- 暗号化トークン列がブラウザから読められていないことの確認
-- （access_token / refresh_token が表示されなければ成功です）
select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'gbp_connections'
  and grantee in ('authenticated', 'anon')
order by grantee, column_name;
`;

/**
 * マイグレーション末尾の「実行結果の確認」クエリを取り除きます。
 *
 * 連結すると同じ確認クエリが重複するため、末尾に1つだけ残します。
 */
function stripTrailingVerification(sql: string): string {
  const marker = "-- 実行結果の確認";
  const index = sql.lastIndexOf(marker);
  if (index === -1) return sql;

  return sql.slice(0, index).trimEnd();
}

/**
 * migrations/ 配下のSQLファイルをファイル名順に読み込みます。
 */
function loadMigrations(): { name: string; sql: string }[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(
      `[setup-all] マイグレーションのディレクトリが見つかりません: ${MIGRATIONS_DIR}`
    );
    process.exit(1);
  }

  const names = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return names.map((name) => ({
    name,
    sql: stripTrailingVerification(
      fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")
    ),
  }));
}

/**
 * setup-all.sql の内容を作ります。
 */
export function buildSetupAll(): string {
  const migrations = loadMigrations();
  const sections = migrations.map(
    (migration) =>
      `-- ---------- ${migration.name} ----------\n${migration.sql.trim()}\n`
  );

  return `${HEADER}\n${sections.join("\n")}\n${FOOTER}`;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const content = buildSetupAll();

  if (checkOnly) {
    const current = fs.existsSync(OUTPUT_PATH)
      ? fs.readFileSync(OUTPUT_PATH, "utf8")
      : "";

    if (current === content) {
      console.log(
        "[setup-all] setup-all.sql は migrations/ と一致しています（差分なし）。"
      );
      return;
    }

    console.error(
      "[setup-all] setup-all.sql が migrations/ と一致しません。" +
        "次のコマンドで再生成してください: npx tsx scripts/generate-setup-all.ts"
    );
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, content, "utf8");
  console.log(
    `[setup-all] setup-all.sql を再生成しました（${loadMigrations().length} 件のマイグレーションを連結）。`
  );
}

main();
