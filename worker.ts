/**
 * Cloudflare Workers のカスタムラッパー。
 *
 * OpenNext が生成する fetch handler をそのまま再利用し、
 * 1時間ごとのレビュー取得（scheduled handler）を追加します。
 * Cloudflare の cron は認証ヘッダーを付けられないため、
 * 内部で /api/reviews/sync を CRON_SECRET 付きで呼び出します。
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore `.open-next/worker.js` は `opennextjs-cloudflare build` で生成されます
import { default as handler } from "./.open-next/worker.js";
/* eslint-enable @typescript-eslint/ban-ts-comment */

type CronEnv = {
  CRON_SECRET?: string;
  [key: string]: unknown;
};

type CronContext = {
  waitUntil(promise: Promise<unknown>): void;
};

const worker = {
  fetch: handler.fetch,

  async scheduled(
    _event: { cron?: string; scheduledTime?: number },
    env: CronEnv,
    ctx: CronContext
  ) {
    if (!env.CRON_SECRET) {
      // 静かに落ちると「レビューが取れない」という形でしか気づけないので明示する
      console.error(
        "[cron] CRON_SECRET が設定されていません。レビューの自動取得は実行されません。" +
          "`npx wrangler secret put CRON_SECRET` で登録してください"
      );
      return;
    }

    const response = await handler.fetch(
      new Request("https://internal/api/reviews/sync", {
        method: "POST",
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      env,
      ctx
    );

    const body = await response.text();
    console.log(`[cron] POST /api/reviews/sync -> ${response.status} ${body}`);
  },
};

export default worker;
