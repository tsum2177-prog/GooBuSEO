export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 30;

/**
 * SEOキーワードをフォームへ渡すための文字列にします。
 *
 * カンマ区切りで渡すと、カンマを含むキーワードが分割されてしまいます。
 * JSONで渡すため、往復しても値が壊れません。
 */
export function serializeSeoKeywords(keywords: string[]): string {
  return JSON.stringify(keywords);
}

/**
 * 受け取った文字列を配列に変換します。
 * JSON配列の形式として受け取ります。旧形式（カンマ区切り）にも対応します。
 */
function toKeywordArray(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 旧形式（カンマ区切り）との互換
  }
  return raw.split(",");
}

/**
 * フォームから受け取ったSEOキーワードを検証して配列に戻します。
 *
 * クライアント側の入力制限だけに頼らず、サーバー側でも
 * 件数と1語あたりの長さを検証します（細工されたリクエスト対策）。
 */
export function parseSeoKeywords(raw: string): string[] {
  const keywords: string[] = [];

  for (const value of toKeywordArray(raw)) {
    const keyword = String(value).trim();
    if (!keyword) continue;
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      console.warn(
        `ignoring an over-long SEO keyword (${keyword.length} characters)`
      );
      continue;
    }
    keywords.push(keyword);
    if (keywords.length >= MAX_KEYWORDS) break;
  }

  return keywords;
}
