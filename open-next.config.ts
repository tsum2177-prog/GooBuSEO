import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // このアプリは全ルートが動的（SSR）のため、ISR/データキャッシュの設定は不要です。
  // 将来 `use cache` や静的生成を使う場合は R2 + D1 + Durable Objects を追加してください。
});
