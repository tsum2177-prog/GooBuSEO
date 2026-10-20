import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken } from "./oauth";

export type GbpConnection = {
  id: string;
  user_id: string;
  google_account_id: string;
  google_account_name: string | null;
  location_id: string;
  location_title: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

export async function listConnections(
  userId: string
): Promise<GbpConnection[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("gbp_connections")
    .select("*")
    .eq("user_id", userId);
  return (data ?? []) as GbpConnection[];
}

export async function saveConnection(input: {
  userId: string;
  googleAccountId: string;
  googleAccountName: string | null;
  locationId: string;
  locationTitle: string | null;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("gbp_connections").upsert(
    {
      user_id: input.userId,
      google_account_id: input.googleAccountId,
      google_account_name: input.googleAccountName,
      location_id: input.locationId,
      location_title: input.locationTitle,
      access_token: encryptSecret(input.accessToken),
      refresh_token: encryptSecret(input.refreshToken),
      expires_at: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
    },
    { onConflict: "user_id,location_id" }
  );

  if (error) {
    throw new Error("Google連携の保存に失敗しました");
  }
}

export async function deleteConnection(
  userId: string,
  connectionId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("gbp_connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("Google連携の解除に失敗しました");
  }
}

export async function getValidAccessToken(
  connection: GbpConnection
): Promise<string> {
  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token);
  }

  const refreshToken = decryptSecret(connection.refresh_token);
  if (!refreshToken) {
    throw new Error("Google連携の期限が切れました。再度連携してください");
  }

  const refreshed = await refreshAccessToken(refreshToken);
  const admin = createAdminClient();
  await admin
    .from("gbp_connections")
    .update({
      access_token: encryptSecret(refreshed.access_token),
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("id", connection.id);

  return refreshed.access_token;
}
