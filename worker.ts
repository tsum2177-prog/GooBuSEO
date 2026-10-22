/**
 * Cloudflare Workers のカスタムラッパー。
 *
 * OpenNext が生成する fetch handler をそのまま再利用し、
 * 1時間ごとのレビュー取得（scheduled handler）を追加します。
 * Cloudflare の cron は認証ヘッダーを付けられないため、
 * 内部で /api/reviews/sync を CRON_SECRET 付きで呼び出します。
 */

/**
 * Worker のバインディング。
 * `npx wrangler secret put CRON_SECRET` で登録した secret binding を含む。
 */
type CronEnv = {
  CRON_SECRET?: string;
  [key: string]: unknown;
};

/** Cloudflare が渡す実行コンテキスト */
type CronContext = {
  waitUntil(promise: Promise<unknown>): void;
};

/**
 * OpenNext が生成する fetch handler の型。
 * `.open-next/worker.js` はビルド時に生成されるファイルなので、
 * 型はここで明示する（`any` は使わない）。
 */
type OpenNextHandler = {
  fetch(
    request: Request,
    env: CronEnv,
    ctx: CronContext
  ): Promise<Response>;
};

/**
 * `.open-next/worker.js` は `opennextjs-cloudflare build` で生成される。
 *
 * この行の `@ts-expect-error` が「使われていない」状態（未使用の抑制コメント）
 * にならないよう、存在しない型を type import で同時に読み込んでいる。
 * - 生成済み（ファイルが存在する）: 「存在しない型の export」エラーになる
 * - 未生成（ファイルが無い）: 「モジュールが見つからない」エラーになる
 * どちらのケースでもこの行にはエラーが1つ残るので、抑制コメントは常に有効。
 * 実行時に残るのは default import だけ（type import は消える）。
 */
// @ts-expect-error `.open-next/worker.js` は `opennextjs-cloudflare build` で生成される
import generatedWorker, { type GeneratedWorkerModule } from "./.open-next/worker.js"; // eslint-disable-line @typescript-eslint/no-unused-vars -- 上記のコメントの通り、型チェックを意図的に失敗させるための型

const handler = generatedWorker as OpenNextHandler;

/**
 * CRON_SECRET を取得する。
 *
 * 取得の順序は route.ts（/api/reviews/sync）と同一。
 *
 * 1. process.env.CRON_SECRET
 *    - 本番（Cloudflare Workers）: `npx wrangler secret put CRON_SECRET` で登録した
 *      secret binding。Worker ランタイムではこの binding が process.env に注入される
 *      （nodejs_compat の populate_process_env と、OpenNext の populateProcessEnv が
 *      process.env[key] = value で上書きする）ため、process.env を読めば
 *      binding と同じ値が取れる。
 *    - ローカル開発: .env.local / .dev.vars
 * 2. Cloudflare の binding（env.CRON_SECRET）を直接参照する。
 *    process.env を読めない環境向けのフォールバック。
 * 3. どちらにも無ければ例外を投げて cron を実行しない。
 *
 * どちらの値も「Cloudflare の secret binding」なので、
 * worker.ts と route.ts で別の値を使う（split-brain）ことは無い。
 */
function getCronSecret(env: CronEnv): string {
  const fromProcessEnv = process.env.CRON_SECRET?.trim();
  const fromBinding = env.CRON_SECRET?.trim();
  const secret = fromProcessEnv || fromBinding;

  if (!secret) {
    throw new Error(
      "CRON_SECRET が設定されていません。`npx wrangler secret put CRON_SECRET` で登録してください。"
    );
  }

  return secret;
}

/**
 * レスポンス本文をそのままログに出さず、必要な情報（件数など）だけを取り出して返す。
 * 本文には認証情報やユーザー情報が含まれ得るため、出力しない。
 */
async function summarizeResponse(response: Response): Promise<string> {
  const status = `ステータス ${response.status}`;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return status;
  }

  if (typeof body !== "object" || body === null) {
    return status;
  }

  const result = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof result.totalUsers === "number") {
    parts.push(`対象 ${result.totalUsers} 件`);
  }
  if (typeof result.processedUsers === "number") {
    parts.push(`処理 ${result.processedUsers} 件`);
  }
  if (typeof result.imported === "number") {
    parts.push(`取込 ${result.imported} 件`);
  }
  if (typeof result.replied === "number") {
    parts.push(`返信 ${result.replied} 件`);
  }

  return parts.length > 0 ? `${status} / ${parts.join(" / ")}` : status;
}

const worker = {
  async fetch(request: Request, env: CronEnv, ctx: CronContext) {
    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    _event: { cron?: string; scheduledTime?: number },
    env: CronEnv,
    ctx: CronContext
  ) {
    const secret = getCronSecret(env);

    const response = await handler.fetch(
      new Request("https://internal/api/reviews/sync", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
      env,
      ctx
    );

    const summary = await summarizeResponse(response);
    if (response.ok) {
      console.log(`[cron] レビュー同期が完了しました: ${summary}`);
    } else {
      console.error(`[cron] レビュー同期に失敗しました: ${summary}`);
    }
  },
};

export default worker;
