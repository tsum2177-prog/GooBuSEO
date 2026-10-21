import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleAuthError, refreshAccessToken } from "./oauth";

export type ConnectionStatus = "active" | "revoked";

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
  status: ConnectionStatus;
};

/**
 * すべての連携を返します。失効（revoked）した連携も含まれます。
 *
 * `select *` を使っているため、`status` カラムが未適用の環境でも
 * 取得は失敗しません（値が undefined になるだけ）。
 */
export async function listConnections(
  userId: string
): Promise<GbpConnection[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("gbp_connections")
    .select("*")
    .eq("user_id", userId);

  return (data ?? []).map((row) => ({
    ...row,
    status: (row.status ?? "active") as ConnectionStatus,
  })) as GbpConnection[];
}

/**
 * 失効していない連携だけを返します。取得・自動返信ではこちらを使います。
 */
export async function listActiveConnections(
  userId: string
): Promise<GbpConnection[]> {
  const connections = await listConnections(userId);
  return connections.filter((connection) => connection.status !== "revoked");
}

/**
 * 失効していない連携が1件でもあるかどうかを返します。
 *
 * 未契約の無料枠では「Googleが連携済みかどうか」だけを判定したいため、
 * トークンまで取得せずに存在確認だけを行います。
 */
export async function hasActiveConnection(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("gbp_connections")
      .select("id, status")
      .eq("user_id", userId);

    if (error) {
      // status カラムが未適用の環境では取得できないので、id だけで判定し直す
      const fallback = await admin
        .from("gbp_connections")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      if (fallback.error) {
        console.error("failed to check google connections", fallback.error);
        return false;
      }
      return (fallback.data ?? []).length > 0;
    }

    return (data ?? []).some((row) => (row.status ?? "active") !== "revoked");
  } catch (error) {
    console.error("failed to check google connections", error);
    return false;
  }
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

  // 失効状態を解除する。
  // status カラムが未適用の環境ではこの更新だけが失敗する（保存自体は成功している）。
  const { error: resetError } = await admin
    .from("gbp_connections")
    .update({ status: "active" })
    .eq("user_id", input.userId)
    .eq("location_id", input.locationId);

  if (resetError) {
    console.error("failed to reset connection status", resetError);
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

/**
 * 失効した連携を `revoked` にします。
 *
 * 失効した refresh token は二度と戻らないため、毎時叩き続けても
 * 成功し続けられません。状態を保存して以後の処理対象から外します。
 */
export async function markConnectionRevoked(
  connectionId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("gbp_connections")
    .update({ status: "revoked" })
    .eq("id", connectionId);

  if (error) {
    // status カラムが未適用の環境（マイグレーション未適用）では失効状態を保持できない
    console.error("failed to mark connection as revoked", error);
  }
}

export async function getValidAccessToken(
  connection: GbpConnection
): Promise<string> {
  if (connection.status === "revoked") {
    throw new GoogleAuthError(
      "access_revoked",
      "Google連携の権限が失効しました。再度連携してください"
    );
  }

  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token);
  }

  const refreshToken = decryptSecret(connection.refresh_token);
  if (!refreshToken) {
    throw new GoogleAuthError(
      "no_refresh_token",
      "Google連携の期限が切れました。再度連携してください"
    );
  }

  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    refreshed = await refreshAccessToken(refreshToken);
  } catch (error) {
    // invalid_grant は refresh token の失効（ユーザーによる権限解除・失効）を意味する。
    // この接続は二度と更新できないので、状態を保存して処理対象から外す。
    if (error instanceof GoogleAuthError && error.code === "invalid_grant") {
      await markConnectionRevoked(connection.id);
    }
    throw error;
  }

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
