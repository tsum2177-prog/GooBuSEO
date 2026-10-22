/**
 * Cloudflare Workers 用のビルドスクリプト。
 *
 * `opennextjs-cloudflare build` はプロジェクト直下の env ファイルを読み取り、
 * その中身を平文リテラルとして `.open-next/cloudflare/next-env.mjs` に書き出す。
 * このファイルは `.open-next/worker.js` を経由してデプロイされる Worker バンドルに
 * 同梱されるため、ビルド時の env ファイル（中身は .gitignore 済みでも
 * デプロイ物には入る）をそのままにしておくと
 * 「ソースには無いはずの service_role キーやトークン暗号鍵」が公開される。
 *
 * そこで次の手順でビルドする。
 *   1. 退避: 秘密情報を含む env ファイルを退避し、公開情報だけの env ファイルに
 *            差し替える（元の内容は同ディレクトリの .build-backup に残す）
 *   2. ビルド: `opennextjs-cloudflare build` を実行する
 *   3. 検査: 生成物 `.open-next` 配下の全ファイルに秘密情報が混ざっていないか確認する
 *   4. 復元: ビルドの成否にかかわらず（try/finally）元の env ファイルを戻す
 *
 * 秘密情報を失わないための工夫:
 * - 前回の実行が中断されて `*.build-backup` が残っている場合は上書きせずエラー終了する
 * - 退避の途中で失敗したら、その場で退避済みのファイルを復元してから終了する
 * - 復元はファイル単位で try/catch し、1 つの失敗で残りの復元を止めない
 * - Ctrl+C（SIGINT）や SIGTERM を受け取ったときも退避済みのファイルを復元する
 *
 * 実行: npx tsx scripts/build-cloudflare.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** プロジェクトのルート（このスクリプトはプロジェクト直下で実行する） */
const PROJECT_ROOT = process.cwd();

/**
 * 退避対象の env ファイル。
 * OpenNext は `.env` / `.{mode}` / `.env.local` / `.{mode}.local` を読み込んで
 * next-env.mjs に平文で書き出すため、対象はこれらのすべて。
 *
 * `.dev.vars` は wrangler がローカル変数を読み込むためのファイルで、ここにも
 * service_role キーなどが含まれる。現状のビルドでは参照されないが、
 * 今後 OpenNext が読む可能性を考えて退避対象に含めておく。
 */
const ENV_FILES = [
  ".env",
  ".env.production",
  ".env.development",
  ".env.test",
  ".env.local",
  ".env.production.local",
  ".env.development.local",
  ".env.test.local",
  ".dev.vars",
] as const;

/**
 * 秘密情報として扱う変数名。
 * env ファイルからの取り除き（退避）と焼き込み検査の双方で同じ判定を使う。
 */
const SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GEMINI_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "OPENAI_API_KEY",
] as const;

/**
 * 公開情報としてそのまま残す変数名（NEXT_PUBLIC_ 接頭辞の変数以外）。
 * ビルドに必要な設定（ wrangler のビルド条件や公開 ID ）が対象。
 */
const PUBLIC_KEYS = [
  "APP_URL",
  "STRIPE_PRICE_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_REDIRECT_URI",
  "GEMINI_MODEL",
  "NODE_ENV",
  "NEXTJS_ENV",
  "WRANGLER_BUILD_CONDITIONS",
  "WRANGLER_BUILD_PLATFORM",
] as const;

/** 退避したファイルのバックアップ suffix */
const BACKUP_SUFFIX = ".build-backup";

/** 検査対象ディレクトリ（OpenNext のビルド生成物） */
const INSPECT_DIR_NAME = ".open-next";

/**
 * 検査時にテキストとして読み込むファイルの上限。
 *
 * `.open-next` には 6MB 超の handler.mjs が含まれるため、上限を 2MB にしてしまうと
 * 秘密情報が焼き込みやすい本体バンドルが検査対象から外れてしまう。
 * 16MB なら現状の生成物のほぼ全部を検査できる。
 */
const INSPECT_MAX_FILE_BYTES = 16 * 1024 * 1024;

/** バイナリファイルとみなす拡張子（テキストとして読まない） */
const BINARY_EXTENSIONS = new Set([
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".wav",
  ".pdf",
  ".zip",
  ".gz",
  ".br",
  ".bz2",
  ".tar",
  ".7z",
  ".rar",
  ".wasm",
  ".node",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);

/** 進捗表示のインターバル（このファイル数ごとに 1 行表示する） */
const INSPECT_PROGRESS_STEP = 100;

/**
 * 値一致検査を行う最小の長さ。
 * 短い値（例: "test"）は誤検出のため照合しない。
 * ただし短い値でもキー名検査では検出できる。
 */
const INSPECT_MIN_VALUE_LENGTH = 8;

/** 公開用のテンプレートファイル名（退避対象外の警告から除外する） */
const ENV_TEMPLATE_SUFFIXES = [".example", ".sample", ".template", ".dist"];

/** 中断シグナルごとの終了コード */
const SIGNAL_EXIT_CODES: Record<string, number> = {
  SIGINT: 130,
  SIGTERM: 143,
};

type SecretValue = {
  /** 変数名 */
  key: string;
  /** 値（空文字は「秘密情報なし」とみなす） */
  value: string;
};

type PreparedEnvFile = {
  /** プロジェクトルートからの相対パス */
  fileName: string;
  /** 退避前の内容 */
  original: string;
  /** バックアップファイルのパス */
  backupPath: string;
};

/**
 * 検査ルール。
 * 退避処理で「実際に除去した」秘密情報から作る。
 */
type InspectionRule = {
  /** 変数名 */
  key: string;
  /** `"KEY": "値"` 形式の焼き込みを探す正規表現 */
  pattern: RegExp;
  /** 値一致検査に使う値（短い値は含めない） */
  values: string[];
};

/** テキストファイルの読み込み結果 */
type TextFile =
  | { kind: "text"; content: string }
  | { kind: "skipped"; reason: string };

/** 検査の結果 */
type InspectionResult = {
  /** 検出された問題（同じ内容は 1 件にまとめる） */
  problems: string[];
  /** 走査したファイル数 */
  scannedCount: number;
  /** テキストとして読み込んだ合計バイト数 */
  scannedBytes: number;
  /** 読み飛ばしたファイル数（バイナリ・サイズ超過・読み取り失敗） */
  skippedCount: number;
};

/** 復元の結果 */
type RestoreResult = {
  /** 復元できたファイル名 */
  restored: string[];
  /** 復元に失敗したファイル名 */
  failures: string[];
};

/**
 * 退避済みで、まだ復元していない env ファイル。
 *
 * シグナルハンドラからも参照するため、モジュール直下で保持する。
 */
let pendingPreparedFiles: PreparedEnvFile[] = [];

/**
 * 前回の実行で退避したファイル（*.build-backup）が残っている場合に投げるエラー。
 *
 * このまま上書きすると「退避済みの内容」で上書きされ、開発者の秘密情報が
 * 失われるため、自動では削除せずエラー終了する。
 */
class StaleBackupError extends Error {
  /** 残っている退避ファイルのパス */
  readonly backupPaths: string[];

  constructor(backupPaths: string[]) {
    super("前回の実行が中断された可能性がある退避ファイルが残っています。");
    this.name = "StaleBackupError";
    this.backupPaths = backupPaths;
  }
}

/** エラーオブジェクトから読みやすいメッセージを取り出す */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 正規表現のメタ文字をエスケープする */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 変数名が秘密情報を指すかどうかを判定する。
 *
 * - NEXT_PUBLIC_ 接頭辞の変数はクライアントバンドルに埋め込まれる公開情報なので残す
 * - 上記の公開変数はそのまま残す
 * - SECRET / TOKEN / PASSWORD などを含む名前や、公開変数に無い *_KEY は秘密情報扱い
 */
function isSecretKey(key: string): boolean {
  if (key.startsWith("NEXT_PUBLIC_")) return false;
  if ((PUBLIC_KEYS as readonly string[]).includes(key)) return false;
  if ((SECRET_KEYS as readonly string[]).includes(key)) return true;
  return /SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|_KEY$/.test(key);
}

/** env ファイルの一行から変数名を取り出す（変数定義でなければ null） */
function parseEnvKey(line: string): string | null {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return match ? match[1] : null;
}

/** env ファイルの値からクォートを取り除く */
function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * env ファイルの内容を分析し、秘密情報を取り除いた内容と、
 * 取り除いた秘密情報の値の一覧・変数名の一覧を返す。
 * 秘密情報以外の行はそのまま（元の文字列のまま）残す。
 *
 * - secretValues: 値が空でない秘密情報（値一致検査に使う）
 * - removedKeys: 取り除いた変数名そのもの（値が空だったものも含む。
 *   キー名による焼き込み検査はこちらを使う）
 */
export function analyzeEnvContent(content: string): {
  sanitized: string;
  secretValues: SecretValue[];
  removedKeys: string[];
} {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  const secretValues: SecretValue[] = [];
  const removedKeys: string[] = [];

  for (const line of lines) {
    const key = parseEnvKey(line);
    if (key === null || !isSecretKey(key)) {
      kept.push(line);
      continue;
    }

    const rawValue = line.slice(line.indexOf("=") + 1);
    const value = parseEnvValue(rawValue);
    removedKeys.push(key);
    if (value !== "") {
      secretValues.push({ key, value });
    }
  }

  return { sanitized: kept.join("\n"), secretValues, removedKeys };
}

/**
 * 既に存在する退避ファイル（*.build-backup）を探す。
 *
 * env ファイル本体が削除済みでも、退避ファイルだけ残っていれば
 * 「秘密情報が失われる」可能性があるので検出する。
 */
function findStaleBackups(): string[] {
  const stale: string[] = [];
  for (const fileName of ENV_FILES) {
    const backupPath = path.join(PROJECT_ROOT, `${fileName}${BACKUP_SUFFIX}`);
    if (fs.existsSync(backupPath)) {
      stale.push(backupPath);
    }
  }
  return stale;
}

/**
 * 退避対象の env ファイルを公開情報だけの内容に差し替える。
 * 元の内容は同じディレクトリに .build-backup として残し、途中でプロセスが落ちても
 * 手動で戻せるようにする。
 *
 * 退避の途中で例外が起きた場合は、ここまでに退避したファイルをその場で復元してから
 * 再スローする（放置すると「秘密信息公开版」のまま残るため）。
 */
function prepareEnvFiles(): {
  prepared: PreparedEnvFile[];
  secretValues: SecretValue[];
  removedKeys: string[];
} {
  const secretValues: SecretValue[] = [];
  const removedKeys: string[] = [];

  // 退避を始める前に、退避ファイルが残っていないかを確認する。
  // 残っている場合、上書きすると本物のバックアップを失うためエラー終了する。
  const staleBackups = findStaleBackups();
  if (staleBackups.length > 0) {
    throw new StaleBackupError(staleBackups);
  }

  try {
    for (const fileName of ENV_FILES) {
      const filePath = path.join(PROJECT_ROOT, fileName);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        continue;
      }

      const original = fs.readFileSync(filePath, "utf8");
      const {
        sanitized,
        secretValues: found,
        removedKeys: removed,
      } = analyzeEnvContent(original);
      secretValues.push(...found);
      removedKeys.push(...removed);

      if (sanitized === original) {
        // 秘密情報が含まれていないので差し替え不要
        continue;
      }

      const backupPath = `${filePath}${BACKUP_SUFFIX}`;
      fs.writeFileSync(backupPath, original, "utf8");
      // バックアップを書けた時点で復元対象として登録する。
      // ここで差し替えに失敗しても、退避ファイルを残したままにしない。
      pendingPreparedFiles.push({ fileName, original, backupPath });
      fs.writeFileSync(filePath, sanitized, "utf8");
    }
  } catch (error) {
    // 退避の途中で失敗したら、ここまでに退避したファイルを復元してから終了する
    console.error(
      `[build] env ファイルの退避に失敗しました: ${errorMessage(error)}`
    );
    console.error("[build] 退避済みの env ファイルを復元します...");
    const result = restoreEnvFiles();
    if (result.restored.length > 0) {
      console.log(
        `[build] env ファイルを復元しました: ${result.restored.join(", ")}`
      );
    }
    if (result.failures.length > 0) {
      console.error(
        "[build] 一部の env ファイルを復元できませんでした。上のメッセージを確認してください。"
      );
    }
    throw error;
  }

  return {
    prepared: [...pendingPreparedFiles],
    secretValues,
    removedKeys: [...new Set(removedKeys)],
  };
}

/**
 * 退避した env ファイルを元に戻す。
 *
 * ファイルごとに try/catch するので、1 つのファイルの復元に失敗しても
 * 残りのファイルの復元は続ける。失敗したファイルは退避ファイルを残すので
 * 手動で復旧できる。
 */
function restoreEnvFiles(): RestoreResult {
  const restored: string[] = [];
  const failures: string[] = [];
  const remaining: PreparedEnvFile[] = [];

  for (const file of pendingPreparedFiles) {
    const filePath = path.join(PROJECT_ROOT, file.fileName);
    try {
      fs.writeFileSync(filePath, file.original, "utf8");
    } catch (error) {
      console.error(
        `[build] ${file.fileName} の復元に失敗しました: ${errorMessage(error)}`
      );
      console.error(
        `[build] 退避ファイルから手動で復元してください: ${file.backupPath}`
      );
      failures.push(file.fileName);
      remaining.push(file);
      continue;
    }

    restored.push(file.fileName);

    try {
      fs.rmSync(file.backupPath, { force: true });
    } catch (error) {
      console.error(
        `[build] ${file.fileName} は復元しましたが、退避ファイルの削除に失敗しました: ${errorMessage(error)}`
      );
      console.error(`[build] 手動で削除してください: ${file.backupPath}`);
      failures.push(file.fileName);
    }
  }

  pendingPreparedFiles = remaining;
  return { restored, failures };
}

/**
 * 退避対象外の env ファイルがないか確認し、あれば警告する。
 *
 * ビルドは止めない（別の名前の env ファイルは Next.js が読み込まないため）。
 * ただし secret の置场所になっている可能性はあるので知らせる。
 */
function warnUntreatedEnvFiles(): void {
  let untreated: string[] = [];
  try {
    untreated = fs
      .readdirSync(PROJECT_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(".env"))
      .filter((name) => !name.endsWith(BACKUP_SUFFIX))
      .filter((name) => !(ENV_FILES as readonly string[]).includes(name))
      .filter(
        (name) => !ENV_TEMPLATE_SUFFIXES.some((suffix) => name.endsWith(suffix))
      );
  } catch {
    return;
  }

  if (untreated.length > 0) {
    console.warn(
      `[build] 注意: 退避対象外の env ファイルが見つかりました: ${untreated.join(", ")}`
    );
    console.warn(
      "[build] これらのファイルに秘密情報が含まれている可能性があります。"
    );
  }
}

/**
 * 退避処理で実際に除去した秘密情報から検査ルールを作る。
 *
 * 固定のキー一覧ではなく「実際に除去した全キー・全値」を使うので、
 * `isSecretKey()` の判定と検査の判定が乖離しない。
 *
 * - キー名検査の対象: 除去した変数名すべて（値が空だったものも含む）
 * - 値一致検査の対象: 除去した値のうち 8 文字以上のもの
 */
function buildInspectionRules(
  secretValues: SecretValue[],
  removedKeys: string[] = []
): InspectionRule[] {
  const valuesByKey = new Map<string, string[]>();

  // 値が空だった変数もキー名検査の対象にする
  for (const key of removedKeys) {
    if (!valuesByKey.has(key)) {
      valuesByKey.set(key, []);
    }
  }

  for (const { key, value } of secretValues) {
    const values = valuesByKey.get(key) ?? [];
    if (
      value.length >= INSPECT_MIN_VALUE_LENGTH &&
      !values.includes(value)
    ) {
      values.push(value);
    }
    valuesByKey.set(key, values);
  }

  const rules: InspectionRule[] = [];
  for (const [key, values] of valuesByKey) {
    rules.push({
      key,
      pattern: new RegExp(
        `["']${escapeRegExp(key)}["']\\s*:\\s*["']([^"']*)["']`,
        "g"
      ),
      values,
    });
  }

  return rules;
}

/** 検査ルールに沿って、テキスト中の焼き込みを検出する */
function findProblems(content: string, rules: InspectionRule[]): string[] {
  const problems = new Set<string>();

  for (const rule of rules) {
    // キー名による検査: 値つきのまま焼き込まれていれば検出する。
    // 値の長さには依存しないので、短い値の別名キーも検出できる。
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const value = (match[1] ?? "").trim();
      if (value !== "") {
        problems.add(`${rule.key} に値が設定されたまま焼き込まれています`);
      }
    }

    // 値による検査: 別の変数名で焼き込まれていた場合も検出する。
    for (const value of rule.values) {
      if (content.includes(value)) {
        problems.add(`${rule.key} の値がそのまま焼き込まれています`);
      }
    }
  }

  return [...problems];
}

/**
 * テキスト中に「値つきの秘密情報」が焼き込まれているかどうかを判定する。
 *
 * - キー名検査: 退避時に除去したキーについて `"KEY": "値"` の形で
 *   値つきで埋め込まれているかを検出する（値の長さには依存しない）
 * - 値一致検査: 退避時に除去した値そのもの（8文字以上）が含まれるかを検出する
 *
 * 検査対象は退避処理で実際に除去した秘密情報（{ key, value }）です。
 * removedKeys を渡すと、値が空だった変数もキー名検査の対象になります。
 * テストや手動確認から使えるよう export しています。
 */
export function hasLeakedSecret(
  bundleContent: string,
  secretValues: SecretValue[],
  removedKeys: string[] = []
): boolean {
  return (
    findProblems(
      bundleContent,
      buildInspectionRules(secretValues, removedKeys)
    ).length > 0
  );
}

/**
 * テキスト中に焼き込まれた秘密情報の問題を列挙する。
 *
 * 戻り値は検出された問題の一覧（空なら問題なし）。
 */
export function findLeakedSecrets(
  bundleContent: string,
  secretValues: SecretValue[],
  removedKeys: string[] = []
): string[] {
  return findProblems(
    bundleContent,
    buildInspectionRules(secretValues, removedKeys)
  );
}

/** ディレクトリ配下のファイルを再帰的に集める */
function collectFiles(root: string): string[] {
  const files: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const dir = queue.pop();
    if (dir === undefined) continue;

    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(
        `[build] ${dir} を読み取れませんでした（スキップします）: ${errorMessage(error)}`
      );
    }
  }

  return files;
}

/**
 * ファイルをテキストとして読み込む。
 *
 * バイナリ（拡張子で判定し、念のため NUL バイトでも判定）と
 * サイズ上限を超えるファイルは読まずにスキップする。
 */
function readTextFile(filePath: string): TextFile {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { kind: "skipped", reason: "バイナリ" };
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.size > INSPECT_MAX_FILE_BYTES) {
      return { kind: "skipped", reason: "サイズ超過" };
    }

    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      return { kind: "skipped", reason: "バイナリ" };
    }

    return { kind: "text", content: buffer.toString("utf8") };
  } catch (error) {
    return { kind: "skipped", reason: `読み取り失敗: ${errorMessage(error)}` };
  }
}

/**
 * ビルド生成物（.open-next 配下）を再帰的に走査し、秘密情報の焼き込みを検査する。
 *
 * 実際のデプロイ物は複数のファイルにまたがるので、next-env.mjs だけを見ると
 * 漏れる。テキストファイルのみを対象にしつつ、100 ファイルごとに進捗を表示する。
 */
function inspectBundle(
  secretValues: SecretValue[],
  removedKeys: string[]
): InspectionResult {
  const root = path.join(PROJECT_ROOT, INSPECT_DIR_NAME);

  if (!fs.existsSync(root)) {
    return {
      problems: [`${root} が生成されていないため検査できません。`],
      scannedCount: 0,
      scannedBytes: 0,
      skippedCount: 0,
    };
  }

  const targets = collectFiles(root);
  const rules = buildInspectionRules(secretValues, removedKeys);
  const found = new Map<string, string>();
  const skipReasons = new Map<string, number>();
  let scannedCount = 0;
  let scannedBytes = 0;
  let skippedCount = 0;

  for (const target of targets) {
    scannedCount += 1;

    const file = readTextFile(target);
    if (file.kind === "skipped") {
      skippedCount += 1;
      skipReasons.set(
        file.reason,
        (skipReasons.get(file.reason) ?? 0) + 1
      );
    } else {
      scannedBytes += Buffer.byteLength(file.content, "utf8");
      for (const problem of findProblems(file.content, rules)) {
        if (!found.has(problem)) {
          found.set(problem, path.relative(PROJECT_ROOT, target));
        }
      }
    }

    if (scannedCount % INSPECT_PROGRESS_STEP === 0) {
      console.log(
        `[build] 検査中... ${scannedCount} / ${targets.length} ファイル (${Math.round(
          scannedBytes / 1024
        )} KB)`
      );
    }
  }

  const skipSummary = [...skipReasons.entries()]
    .map(([reason, count]) => `${reason} ${count} ファイル`)
    .join(" / ");
  console.log(
    `[build] 検査対象: ${INSPECT_DIR_NAME} 配下 ${targets.length} ファイル / ${Math.round(
      scannedBytes / 1024
    )} KB（読み飛ばし ${skippedCount} ファイル${
      skipSummary ? ` : ${skipSummary}` : ""
    }）`
  );

  const problems = [...found].map(
    ([problem, file]) => `${file}: ${problem}`
  );

  return { problems, scannedCount, scannedBytes, skippedCount };
}

/** `opennextjs-cloudflare build` を実行する。終了コードをそのまま返す。 */
function runBuild(): number {
  console.log("[build] opennextjs-cloudflare build を実行します...");

  const result = spawnSync("npx", ["opennextjs-cloudflare", "build"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    // Windows では npx.cmd を実行するためシェル経由でないと起動できない
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(
      `[build] opennextjs-cloudflare build を実行できませんでした: ${result.error.message}`
    );
    return 1;
  }

  if (result.signal) {
    console.error(`[build] ビルドが中断されました（${result.signal}）`);
    return SIGNAL_EXIT_CODES[result.signal] ?? 1;
  }

  return result.status ?? 1;
}

/**
 * SIGINT / SIGTERM で中断されたときに退避済みの env ファイルを復元する
 * ハンドラを登録する。
 *
 * ハンドラを登録していないと Node の既定の挙動で即座に終了するため、
 * ビルド中に Ctrl+C しても復元処理が走らない。
 *
 * 返り値の関数を呼ぶとハンドラを解除する（復元が完了した後は不要のため）。
 */
function registerTerminationHandlers(): () => void {
  const handle = (signal: string): void => {
    // 既に復元済み（退避済みファイルが無い）なら二重に復元しない
    if (pendingPreparedFiles.length > 0) {
      console.error(
        `\n[build] ${signal} を受け取りました。退避済みの env ファイルを復元しています...`
      );
      const result = restoreEnvFiles();
      if (result.failures.length > 0) {
        console.error(
          "[build] 一部の env ファイルを復元できませんでした。上のメッセージを確認してください。"
        );
      } else {
        console.error(
          `[build] env ファイルを復元しました: ${result.restored.join(", ")}`
        );
      }
    }

    process.exitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
  };

  const onSigint = (): void => handle("SIGINT");
  const onSigterm = (): void => handle("SIGTERM");

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}

/**
 * このスクリプトを直接実行したかどうかを判定する。
 *
 * テストから import したときはビルドを実行しない。
 */
function isDirectlyExecuted(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;

  const entryPath = path.resolve(entry);
  const selfPath = path.resolve(fileURLToPath(import.meta.url));
  if (entryPath === selfPath) return true;

  try {
    return fs.realpathSync(entryPath) === fs.realpathSync(selfPath);
  } catch {
    return false;
  }
}

function main(): void {
  if (!fs.existsSync(path.join(PROJECT_ROOT, "package.json"))) {
    console.error(
      "[build] プロジェクトルートで実行してください（package.json が見つかりません）。"
    );
    process.exitCode = 1;
    return;
  }

  warnUntreatedEnvFiles();

  const removeTerminationHandlers = registerTerminationHandlers();

  let exitCode = 0;

  try {
    const { prepared, secretValues, removedKeys } = prepareEnvFiles();

    if (prepared.length > 0) {
      console.log(
        `[build] 秘密情報を含む env ファイルを退避しました: ${prepared
          .map((file) => file.fileName)
          .join(", ")}`
      );
    } else {
      console.log("[build] 退避が必要な env ファイルはありませんでした。");
    }

    try {
      const buildStatus = runBuild();
      if (buildStatus !== 0) {
        console.error(`[build] ビルドに失敗しました（終了コード: ${buildStatus}）`);
        exitCode = buildStatus;
      } else {
        // --- 生成物にかかった秘密情報の検査 ---------------------------------
        const inspection = inspectBundle(secretValues, removedKeys);

        if (inspection.problems.length > 0) {
          console.error(
            `[build] 生成物 (${INSPECT_DIR_NAME}) に秘密情報が含まれているため中断します:`
          );
          for (const problem of inspection.problems) {
            console.error(`  - ${problem}`);
          }
          exitCode = 1;
        } else {
          console.log(
            `[build] 検査に合格しました: ${inspection.scannedCount} ファイルに秘密情報は含まれていません。`
          );
        }
      }
    } finally {
      // ビルドが失敗しても必ず元の env ファイルを復元する
      const result = restoreEnvFiles();
      if (result.restored.length > 0) {
        console.log(
          `[build] env ファイルを復元しました: ${result.restored.join(", ")}`
        );
      }
      if (result.failures.length > 0) {
        console.error(
          "[build] env ファイルの復元に失敗したファイルがあります（終了コードを 1 にします）。"
        );
        exitCode = 1;
      }
    }
  } catch (error) {
    if (error instanceof StaleBackupError) {
      console.error(
        "[build] 前回の実行が中断された可能性があります。以下の退避ファイルが残っています:"
      );
      for (const backupPath of error.backupPaths) {
        console.error(`  - ${backupPath}`);
      }
      console.error(
        "[build] 内容を確認してから、必要に応じて手動で削除してください（このスクリプトでは自動的に削除しません）。"
      );
    } else {
      console.error(`[build] 失敗しました: ${errorMessage(error)}`);
    }
    exitCode = 1;
  } finally {
    removeTerminationHandlers();
  }

  // process.exit() はパイプ時の出力を切り取ることがあるため、終了コードだけ設定して
  // 自然終了させる
  process.exitCode = exitCode;
}

if (isDirectlyExecuted()) {
  main();
}
