"use client";

/**
 * ルートレイアウト自体の例外を受け止める最外の境界。
 * レイアウトが描画できないため、TailwindのCSSが読まれる前提ができない。
 * そこでインラインスタイルのみで構成しています。
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "24px",
          textAlign: "center",
          fontFamily:
            'system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
          color: "#111827",
          background: "#ffffff",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
          エラーが発生しました
        </h1>
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6, color: "#4b5563" }}>
          画面の表示に失敗しました。ブラウザを再読み込みするか、
          <br />
          時間をおいて再度お試しください。
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "8px",
            padding: "8px 16px",
            border: 0,
            borderRadius: "8px",
            background: "#111827",
            color: "#ffffff",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          再読み込みする
        </button>
      </body>
    </html>
  );
}
