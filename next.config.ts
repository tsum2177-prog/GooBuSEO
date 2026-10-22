import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * アプリ全体（/:path*）に付与するセキュリティヘッダー。
 */
const securityHeaders = [
  // レスポンスの Content-Type を推測させない
  { key: "X-Content-Type-Options", value: "nosniff" },
  // iframe への埋め込みを禁止する（クリックジャッキング対策）
  { key: "X-Frame-Options", value: "DENY" },
  // 別オリジンへ遷移するとき、Referer にURL全体を送らない
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 2年間 https を強制する。本番は https で配信されるため有効になる。
  // ローカル開発は http のため、ブラウザには無視される。
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // カメラ・マイク・位置情報の利用を禁止する
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * Content-Security-Policy は意図的にまだ設定していない。
 *
 * このアプリは Next.js の Script とインラインスクリプトを使うため、
 * 素の CSP を入れるとページが白画面になることがある。
 * 段階的に導入する場合は、まず下のような緩い設定で配信し、
 * 実害がないことを確認してから 'unsafe-inline' / 'unsafe-eval' を外す運用にする。
 *
 *   {
 *     key: "Content-Security-Policy",
 *     value: [
 *       "default-src 'self'",
 *       "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
 *       "style-src 'self' 'unsafe-inline'",
 *       "img-src 'self' data: blob: https:",
 *       "font-src 'self' data:",
 *       "connect-src 'self' https://*.supabase.co",
 *       "frame-ancestors 'none'",
 *       "base-uri 'self'",
 *       "object-src 'none'",
 *     ].join("; "),
 *   }
 *
 * 特に connect-src には Supabase の API 呼び出し先
 * （https://*.supabase.co）を含めること。ここを絞ると
 * ログインやレビュー取得が失敗する。
 */
const nextConfig: NextConfig = {
  /* config options here */
  // Cache Components（cacheComponents / partialPrefetching）は
  // Cloudflare Workers（workerd）の setTimeout() 実装と非互換で、
  // ページ描画がハングするため無効化しています。
  allowedDevOrigins: ["127.0.0.1"],
  // Cloudflare Workers へのデプロイで OpenNext が要求する出力形式
  output: "standalone",
  // レスポンスに X-Powered-By を付けない
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // アプリ全体のルート
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

// ローカル開発時に Cloudflare のバインディングを再現するための初期化
initOpenNextCloudflareForDev();
