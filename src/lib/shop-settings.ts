import { matchCategory } from "@/lib/shop-categories";
import { createAdminClient } from "@/lib/supabase/admin";

export type LocationSummary = {
  title?: string | null;
  primaryCategory?: {
    name?: string;
    displayName?: string;
  } | null;
};

/**
 * Googleマップの店舗情報から、店舗設定の初期値を作ります。
 *
 * 店主が設定済みの値は上書きしません。Googleマップの表記が
 * 店主の手入力より正しいとは限らないためです。
 */
export async function fillShopSettingsFromLocations(
  userId: string,
  locations: LocationSummary[]
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing, error } = await admin
    .from("shop_settings")
    .select("shop_name, category")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("failed to read shop settings", error);
    return;
  }

  // 店舗名と業種は、最初の1店舗から取ります
  // （Googleマップの連携で複数店舗が登録されるためです）。
  const location = locations.find((item) => item.title) ?? locations[0];

  const shopName =
    existing?.shop_name ||
    (location?.title ? location.title.trim().slice(0, 100) : null);

  const category =
    existing?.category || matchCategory(location?.primaryCategory?.displayName);

  if (!shopName && !category) return;

  if (existing) {
    const { error: updateError } = await admin
      .from("shop_settings")
      .update({ shop_name: shopName, category })
      .eq("id", userId);
    if (updateError) {
      console.error("failed to update shop settings", updateError);
    }
    return;
  }

  const { error: insertError } = await admin.from("shop_settings").upsert(
    { id: userId, shop_name: shopName, category },
    { onConflict: "id" }
  );
  if (insertError) {
    console.error("failed to create shop settings", insertError);
  }
}
