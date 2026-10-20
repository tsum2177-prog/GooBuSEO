const GEMINI_CHAT_COMPLETIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export type ReplyInput = {
  rating: number;
  reviewText: string;
  reviewerName?: string | null;
  shopName?: string | null;
  category?: string | null;
  strengths?: string | null;
  seoKeywords: string[];
};

function buildSystemPrompt(isLowRating: boolean): string {
  const rules = [
    "あなたはローカル店舗のGoogleマップレビューに返信する秘書です。",
    "指定された条件を満たす日本語の返信文だけを出力してください。",
  ];

  if (isLowRating) {
    rules.push(
      "評価が低い（1〜3点）レビューです。感情的にならず、誠実に謝罪し、今後の改善方針を具体的に示してください。",
      "SEOキーワードは絶対に入れません。"
    );
  } else {
    rules.push(
      "評価が高い（4〜5点）レビューです。感謝を伝えつつ、渡されたSEOキーワードを文章に自然に盛り込んでください。",
      "キーワードは並べるのではなく、文中が不自然にならない形で入れてください。"
    );
  }

  rules.push(
    "返信文は、その業種に合った言い回しにしてください。",
    "200〜300字程度の1段落で、丁寧語を使って店舗側の立場で書いてください。",
    "説明文や記号、Markdownは不要です。返信文のみを出力してください。"
  );

  return rules.join("\n");
}

export async function generateReply(input: ReplyInput): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const isLowRating = input.rating <= 3;
  const keywords = isLowRating ? [] : input.seoKeywords;

  const userPrompt = [
    `【店舗名】${input.shopName ?? "店舗名未設定"}`,
    `【業種】${input.category ?? "未設定"}`,
    `【店舗の特徴】${input.strengths ?? "未設定"}`,
    `【SEOキーワード】${keywords.length > 0 ? keywords.join("、") : "なし"}`,
    `【評価】${input.rating}点`,
    `【お客様名】${input.reviewerName ?? "お客様"}`,
    `【レビュー本文】${input.reviewText}`,
  ].join("\n");

  const response = await fetch(GEMINI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(isLowRating) },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error("AI APIでエラーが発生しました");
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("AI APIから返信文を取得できませんでした");
  }

  return content;
}
