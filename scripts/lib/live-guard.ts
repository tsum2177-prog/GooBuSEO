/**
 * 本番DB（Supabase）を書き換える検証スクリプトのための共通ガード。
 *
 * 背景:
 * - scripts/ 以下の検証スクリプトは service_role クライアントで本番DBへ直接書き込む
 * - 保護機構がなく、誤実行すると有料顧客の profiles 行を消して契約状態を壊す
 *
 * このファイルで共通化すること:
 * 1. 明示的な同意（ALLOW_LIVE_DB=1）がない限り、DBに一切触れない
 * 2. 実行前に「どのDBに」「何を」行うかを日本語で表示する
 * 3. profiles 行を行全体でスナップショットし、終了時に元へ戻す
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * 同意フラグのキーです。
 *
 * 同意は「実行者がその場で環境変数へ設定した時」だけ有効にします。
 * .env.local へ書いて固定化すると、気づかないまま本番DBを書き換える
 * 運用になるため、ファイルからは読み込みません。
 */
const CONSENT_ENV_KEYS = ["ALLOW_LIVE_DB", "ALLOW_PRODUCTION_DB"];

/** バナーの横幅 */
const BANNER_WIDTH = 72;

export type LiveGuardOptions = {
  /** ログに出すスクリプト名（例: scripts/verify-paywall.ts） */
  scriptName: string;
  /** 実行しようとしている操作の要約（日本語） */
  operations: string[];
};

/**
 * profiles 行のスナップショットです。
 *
 * `existed` は「行が存在したか」を表します。
 * subscription_status の値では判定しません
 * （行が存在して subscription_status が NULL の場合もあるため）。
 */
export type ProfileSnapshot = {
  /** スナップショット時点で行が存在したか */
  existed: boolean;
  /** 行に存在する全列の値 */
  row: Record<string, unknown>;
};

/**
 * `server-only` マーカーを Node 上で無効化します。
 *
 * `server-only` は「クライアントコンポーネントから import できない」ことを示す
 * Next.js 用のマーカーです。Node 上で実行する検証スクリプトでは意味を持たず、
 * 読み込むだけで例外を投げてスクリプトが動かなくなります。
 * アプリ側の保護は Next.js のビルド時に働くため、スクリプト側で無効にしても
 * ガードが弱くなることはありません。
 *
 * 注意: この処理は live-guard を読み込む_module_ の中で実行されます。
 * そのため、検証スクリプトは live-guard を src/lib より先に import してください。
 */
function disableServerOnlyMarker(): void {
  try {
    const nodeRequire = createRequire(path.join(process.cwd(), "noop.js"));
    const Module = nodeRequire("node:module") as unknown as {
      _load: (
        request: string,
        parent: unknown,
        isMain: boolean
      ) => unknown;
    };
    const originalLoad = Module._load;
    Module._load = (request, parent, isMain) => {
      if (request === "server-only") return {};
      return originalLoad(request, parent, isMain);
    };
  } catch {
    // 無効化できない場合は、そのまま続行します
    // （この場合、server-only を import するモジュールの読み込みで失敗します）
  }
}

disableServerOnlyMarker();

/**
 * .env.local を読み込みます。
 *
 * 同意フラグ（ALLOW_LIVE_DB / ALLOW_PRODUCTION_DB）はファイルからは読み込みません。
 * 実行者が明示的に環境変数へ設定した場合だけ同意として扱います。
 */
export function loadLocalEnv(envPath = ".env.local"): void {
  if (!fs.existsSync(envPath)) {
    console.warn(
      `警告: ${envPath} が見つかりません（環境変数から直接読み込みます）`
    );
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (CONSENT_ENV_KEYS.includes(key)) continue;
    process.env[key] ??= line.slice(i + 1).trim();
  }
}

/**
 * 接続先のホスト名（APIキーは含めない）を取得します。
 */
function getTargetHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * 枠線つきのメッセージを出します。
 */
function printBanner(lines: string[]): void {
  const separator = "=".repeat(BANNER_WIDTH);
  console.log(separator);
  for (const line of lines) console.log(line);
  console.log(separator);
}

/**
 * 本番DBへの書き込みが許可されているかを確認します。
 *
 * - ALLOW_LIVE_DB=1 が無い場合は、DBに触れずに（この時点ではDBへ接続もせず）
 *   日本語のメッセージを出して非ゼロ終了します
 * - NODE_ENV=production の場合は、書き込みが本番DBへ及ぶことを大きく警告します
 *   （同意フラグは1段だけで十分です。2段目にするには下の exit(1) を有効にしてください）
 * - 許可された場合は、接続先ホストと実行する操作の要約を表示します
 */
export function assertLiveDbAllowed(options: LiveGuardOptions): void {
  const host = getTargetHost();

  if (!host) {
    printBanner([
      "NEXT_PUBLIC_SUPABASE_URL が設定されていないため、対象DBを特定できません。",
      "環境変数（.env.local）を確認してから実行してください。",
      "データには一切触れません。",
    ]);
    process.exit(1);
  }

  if (process.env.ALLOW_LIVE_DB?.trim() !== "1") {
    printBanner([
      "このスクリプトは本番DB（Supabase）を書き換えます。",
      "実行するには環境変数 ALLOW_LIVE_DB=1 を設定してください。",
      "",
      `  対象DB: ${host}`,
      "",
      `  PowerShell: $env:ALLOW_LIVE_DB="1"; npx tsx ${options.scriptName}`,
      `  bash/zsh : ALLOW_LIVE_DB=1 npx tsx ${options.scriptName}`,
      "",
      "データには一切触れません。",
    ]);
    process.exit(1);
  }

  if (
    process.env.NODE_ENV?.trim() === "production" &&
    process.env.ALLOW_PRODUCTION_DB?.trim() !== "1"
  ) {
    // 本番モードでも実行自体は止めません（同意フラグは ALLOW_LIVE_DB=1 で
    // 1段だけで十分です）。ただし書き込みが本番DBへ及ぶことを大きく警告します。
    // 2段目の同意を必須にしたい場合は、この exit(1) を有効にしてください。
    printBanner([
      "!! 警告: NODE_ENV=production で実行しています。",
      "   このスクリプトは本番DB（Supabase）を書き換えます。",
      "   ALLOW_PRODUCTION_DB=1 を設定すると、2段目の確認済みとして記録されます。",
      "",
      `  対象DB: ${host}`,
      "",
      "!! 実行を続けます（Ctrl+C で中止できます）",
    ]);
  }

  printBanner([
    "本番DBへの書き込みを許可しました。",
    `  スクリプト: ${options.scriptName}`,
    `  対象DB    : ${host}（ホストのみ表示。APIキーは表示しません）`,
    `  NODE_ENV  : ${process.env.NODE_ENV?.trim() || "（未設定）"}`,
    ...(process.env.ALLOW_PRODUCTION_DB?.trim() === "1"
      ? ["  本番書き込み: 2段目の確認済み（ALLOW_PRODUCTION_DB=1）"]
      : []),
    "",
    "実行する操作:",
    ...options.operations.map((operation) => `  - ${operation}`),
    "",
    "終了時に元の状態へ復元します（Ctrl+C で中断した場合も復元を試みます）。",
  ]);
}

/**
 * service_role のクライアントを取得します。
 *
 * `src/lib/supabase/admin` は `server-only` を import するため、
 * Node 上で読み込む前に {@link disableServerOnlyMarker} を実行する必要があります。
 * そのためここでは動的 import にします。
 */
async function getAdminClient() {
  const { createAdminClient } = await import("../../src/lib/supabase/admin");
  return createAdminClient();
}

/**
 * profiles 行を行全体のスナップショットとして保存します。
 *
 * 取得するのは subscription_status だけではなく、行に存在する全列
 * （email / stripe_customer_id / stripe_price_id など）です。
 * 存在判定は maybeSingle() が返した data に行があるかどうかで行います。
 * subscription_status の値では判定しません
 * （行が存在して subscription_status が NULL の場合があるため）。
 */
export async function snapshotProfile(
  userId: string
): Promise<ProfileSnapshot> {
  const admin = await getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`profiles 行の読み取りに失敗しました: ${error.message}`);
  }

  // 「行が存在するか」は、返ってきた行の有無だけで判定します
  const existed = data !== null && data !== undefined;
  const row = (data ?? {}) as Record<string, unknown>;

  return { existed, row };
}

/**
 * profiles 行をスナップショットの状態へ復元します。
 *
 * - 元に行が存在した → 行の値をすべて書き戻す
 * - 元に行が存在しなかった → 行を削除する
 */
export async function restoreProfile(
  userId: string,
  snapshot: ProfileSnapshot
): Promise<void> {
  const admin = await getAdminClient();

  if (!snapshot.existed) {
    const { error } = await admin.from("profiles").delete().eq("id", userId);
    if (error) {
      throw new Error(`profiles 行の削除に失敗しました: ${error.message}`);
    }
    return;
  }

  const { error } = await admin
    .from("profiles")
    .upsert(snapshot.row, { onConflict: "id" });

  if (error) {
    throw new Error(`profiles 行の復元に失敗しました: ${error.message}`);
  }
}

/**
 * 中断（Ctrl+C）時に実行する後始末を登録します。
 *
 * Node は SIGINT を受けると即座に終了するため、後始末が走らないと
 * テスト用の書き込みが本番DBに残ります。そこで、後始末を実行してから終了します。
 */
export function registerInterruptRestore(
  restore: () => Promise<void>
): void {
  let running = false;

  process.on("SIGINT", () => {
    if (running) return;
    running = true;
    console.error("\n中断されました。元の状態へ復元しています...");
    restore()
      .then(() => {
        console.error("復元しました。");
        process.exit(130);
      })
      .catch((error: unknown) => {
        console.error(
          "復元に失敗しました。手動で元の状態へ戻してください:",
          error
        );
        process.exit(130);
      });
  });
}
