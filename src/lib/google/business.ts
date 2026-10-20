const API_BASE = "https://mybusiness.googleapis.com/v4";

export type GoogleReview = {
  name: string;
  reviewer?: {
    displayName?: string;
    isAnonymous?: boolean;
  };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: {
    comment?: string;
    updateTime?: string;
  };
};

export type GoogleAccount = {
  name: string;
  accountName?: string;
};

export type GoogleLocation = {
  name: string;
  title?: string;
};

async function googleFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Google APIエラー（${response.status}）`);
  }

  return (await response.json()) as T;
}

export async function listAccounts(
  accessToken: string
): Promise<GoogleAccount[]> {
  const data = await googleFetch<{ accounts?: GoogleAccount[] }>(
    "/accounts",
    accessToken
  );
  return data.accounts ?? [];
}

export async function listLocations(
  accountName: string,
  accessToken: string
): Promise<GoogleLocation[]> {
  const data = await googleFetch<{ locations?: GoogleLocation[] }>(
    `/${accountName}/locations`,
    accessToken
  );
  return data.locations ?? [];
}

export async function listReviews(
  locationName: string,
  accessToken: string
): Promise<GoogleReview[]> {
  const data = await googleFetch<{
    reviews?: GoogleReview[];
    nextPageToken?: string;
  }>(
    `/${locationName}/reviews?pageSize=50&orderBy=${encodeURIComponent(
      "updateTime desc"
    )}`,
    accessToken
  );
  return data.reviews ?? [];
}

export async function replyToReview(
  reviewName: string,
  comment: string,
  accessToken: string
): Promise<void> {
  await googleFetch<unknown>(`/${reviewName}/reply`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ comment }),
  });
}

const starRatings: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export function toStarRating(starRating?: string): number {
  if (!starRating) return 0;
  return starRatings[starRating] ?? 0;
}
