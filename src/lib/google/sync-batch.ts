/**
 * 1回の実行あたりに処理するレビュー数。
 *
 * 未返信が積み上がった店舗で全件を処理すると、Geminiの呼び出しと
 * GBPへの投稿が連発して、Workerの実行上限に達して途中で止まるため。
 */
export const AUTO_REPLY_BATCH_SIZE = 20;

/**
 * 1回の実行あたりに処理するユーザー数。
 *
 * 全ユーザーを1つのWorker実行で処理すると、店舗数やレビュー数に応じて
 * 実行上限に達して途中で止まります。
 */
export const USERS_PER_RUN = 20;

/**
 * 時刻ベースの開始位置で回転させた、今回の実行で対象とするユーザーを返します。
 *
 * 単に「先頭からN件」だけだと、同じユーザーだけが毎回処理されて
 * 残りが永久に空回りします。実行が1時間ごとなので、時刻で開始位置をずらします。
 */
export function selectUsersForRun(
  userIds: string[],
  now: number = Date.now()
): string[] {
  if (userIds.length <= USERS_PER_RUN) return userIds;

  const sorted = [...userIds].sort();
  const start = Math.floor(now / 3_600_000) % sorted.length;
  const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
  return rotated.slice(0, USERS_PER_RUN);
}
