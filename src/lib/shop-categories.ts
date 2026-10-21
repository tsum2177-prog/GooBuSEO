/**
 * 店舗の種類（業種）の選択肢と、Googleマップの業種名への対応表。
 */

export const SHOP_CATEGORIES = [
  "飲食店",
  "居酒屋・バー",
  "喫茶店・カフェ",
  "美容院・理容店",
  "歯科医院・クリニック",
  "ホテル・旅館",
  "その他",
] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

/**
 * Googleマップの業種名を、アプリの選択肢に対応させます。
 *
 * Googleマップのカテゴリ表記は英語と日本語が混在し、「Restaurant with Beer」
 * のような区分もあります。確実に写像できないものは null を返して、
 * 店主自身が選ぶようにします。
 *
 * 判定の順番に意味があるので、より具体的な語から並べます
 * （"barber" は "bar" に含まれるので先に見る必要があります）。
 */
const CATEGORY_RULES: { category: ShopCategory; keywords: string[] }[] = [
  {
    category: "美容院・理容店",
    keywords: [
      "barber",
      "beauty salon",
      "hair salon",
      "hairdresser",
      "nail salon",
      "beauty",
      "理容",
      "美容",
      "ヘアサロン",
    ],
  },
  {
    category: "喫茶店・カフェ",
    keywords: [
      "bubble tea",
      "coffee shop",
      "tea house",
      "cafe",
      "coffee",
      "ice cream",
      "喫茶店",
      "カフェ",
      "コーヒー",
    ],
  },
  {
    category: "居酒屋・バー",
    keywords: [
      "cocktail bar",
      "wine bar",
      "izakaya",
      "brewery",
      "bar",
      "pub",
      "スナック",
      "居酒屋",
    ],
  },
  {
    category: "歯科医院・クリニック",
    keywords: [
      "dental clinic",
      "dentist",
      "dental",
      "clinic",
      "doctor",
      "physician",
      "pharmacy",
      "veterinary",
      "optician",
      "歯科",
      "クリニック",
      "薬局",
    ],
  },
  {
    category: "ホテル・旅館",
    keywords: [
      "hotel",
      "ryokan",
      "hostel",
      "motel",
      "resort",
      "旅館",
      "ホテル",
    ],
  },
  {
    category: "飲食店",
    keywords: [
      "restaurant",
      "ramen",
      "sushi",
      "pizza",
      "bistro",
      "curry",
      "yakitori",
      "steakhouse",
      "food",
      " cafeteria",
      "bakery",
      "ラーメン",
      "寿司",
      "焼肉",
      "レストラン",
      "食堂",
    ],
  },
];

/**
 * Googleマップの業種名を、アプリの選択肢に写像します。
 *
 * 対応する選択肢が無い場合は null を返します（未設定のままにします）。
 */
export function matchCategory(
  displayName: string | null | undefined
): ShopCategory | null {
  if (!displayName) return null;

  const text = displayName.trim().toLowerCase();
  if (!text) return null;

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.category;
    }
  }

  return null;
}
