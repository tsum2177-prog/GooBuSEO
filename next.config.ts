import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
  // Cache Components（cacheComponents / partialPrefetching）は
  // Cloudflare Workers（workerd）の setTimeout() 実装と非互換で、
  // ページ描画がハングするため無効化しています。
  allowedDevOrigins: ["127.0.0.1"],
  // Cloudflare Workers へのデプロイで OpenNext が要求する出力形式
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// ローカル開発時に Cloudflare のバインディングを再現するための初期化
initOpenNextCloudflareForDev();
