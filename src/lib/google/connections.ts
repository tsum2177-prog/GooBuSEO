import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleApiError } from "./api-error";
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
 * `status` カラムが無いことによる失敗かどうかを判定します。
 *
 * PostgREST は、存在しない列を含むリクエストを `PGRST204` として返します。
 * status カラムが未適用の環境だけ保存方法を切り替え、それ以外の失敗
 * （制約違反など）はそのままエラーとして扱います。
 */
function isMissingStatusColumnError(error: {
  code: string;
  message: string;
}): boolean {
  if (error.code === "PGRST204") {
    return true;
  }
  return /status/i.test(error.message) && /column/i.test(error.message);
}

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
 * 未契約の無料枠では「Googleマップの連携が済んでいるかどうか」だけを判定したいため、
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
        console.error("Google連携の有無を確認できませんでした", fallback.error);
        return false;
      }
      return (fallback.data ?? []).length > 0;
    }

    return (data ?? []).some((row) => (row.status ?? "active") !== "revoked");
  } catch (error) {
    console.error("Google連携の有無を確認できませんでした", error);
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
  const values = {
    user_id: input.userId,
    google_account_id: input.googleAccountId,
    google_account_name: input.googleAccountName,
    location_id: input.locationId,
    location_title: input.locationTitle,
    access_token: encryptSecret(input.accessToken),
    refresh_token: encryptSecret(input.refreshToken),
    expires_at: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
  };

  // 失効状態を解除した状態（status: "active"）で1クエリにまとめます。
  // 2段階にすると、後ろの status 更新が失敗しても握りつぶされ、
  // 再連携しても revoked のまま（＝サイレントに同期されない）になります。
  const { error } = await admin.from("gbp_connections").upsert(
    {
      ...values,
      status: "active",
    },
    { onConflict: "user_id,location_id" }
  );

  if (!error) {
    return;
  }

  // status カラムが未適用の環境（マイグレーション未適用）では upsert ごと失敗します。
  // その環境だけ status を外して保存し直し、status の更新は任意として扱います。
  if (!isMissingStatusColumnError(error)) {
    throw new Error("Google連携の保存に失敗しました");
  }

  console.warn(
    "status カラムが無いため、Google連携の保存を status なしで再実行します",
    error
  );

  const { error: fallbackError } = await admin
    .from("gbp_connections")
    .upsert(values, { onConflict: "user_id,location_id" });

  if (fallbackError) {
    throw new Error("Google連携の保存に失敗しました");
  }

  const { error: resetError } = await admin
    .from("gbp_connections")
    .update({ status: "active" })
    .eq("user_id", input.userId)
    .eq("location_id", input.locationId);

  if (resetError) {
    console.error("連携状態を active に戻せませんでした", resetError);
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
 *
 * `userId` を渡すと `user_id` でも絞り込みます。
 * service_role クライアントは RLS を迂回するため、DB側の制約に頼れず、
 * コード側でテナント境界を担保する必要があります。id だけを渡すと
 * 他ユーザーの連携も失効させてしまうため、呼び出し元では必ず渡してください。
 */
export async function markConnectionRevoked(
  connectionId: string,
  userId?: string
): Promise<void> {
  const admin = createAdminClient();
  const target = admin
    .from("gbp_connections")
    .update({ status: "revoked" })
    .eq("id", connectionId);

  // user_id が分かる場合は、必ずテナント境界で絞り込みます。
  const query = userId ? target.eq("user_id", userId) : target;

  const { error } = await query;

  if (error) {
    // status カラムが未適用の環境（マイグレーション未適用）では失効状態を保持できない
    console.error("連携を失効扱いとして保存できませんでした", error);
  }
}

/**
 * 接続を失効扱いにして、以後の処理対象から外します。
 *
 * Google 側で権限が解除されたとき（スコープの削除・プロジェクト側での遮断など）は、
 * refresh token が有効なままでも GBP API だけが 401 を返します。
 * 失効状態を保存しないと、毎時cronが同じ接続を叩き続けます。
 */
export async function revokeConnection(
  connection: GbpConnection
): Promise<void> {
  console.warn(
    "Google連携のアクセスが失効しました。再度連携してください",
    {
      connectionId: connection.id,
      locationId: connection.location_id,
    }
  );
  await markConnectionRevoked(connection.id, connection.user_id);
}

/**
 * GBP API の呼び出しを実行し、401（アクセスの失効）を検出したら
 * 接続を失効扱いにして、再連携を促すエラーに置き換えます。
 *
 * Google 側で権限が解除されたときは、トークンエンドポイントは 200 を返したまま
 * GBP API だけが 401 を返します。このままでは接続が active のまま残り、
 * 毎時cronが同じ接続を叩き続けます。
 *
 * 呼び出し側は `GoogleAuthError` を受け取るので、
 * 「再連携してください」のメッセージを表示できます。
 */
export async function withValidAccessToken<T>(
  connection: GbpConnection,
  action: (accessToken: string) => Promise<T>
): Promise<T> {
  const accessToken = await getValidAccessToken(connection);

  try {
    return await action(accessToken);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 401) {
      await revokeConnection(connection);
      throw new GoogleAuthError(
        "access_revoked",
        "Google連携のアクセスが失効しました。再度連携してください"
      );
    }
    throw error;
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
      await markConnectionRevoked(connection.id, connection.user_id);
    }
    throw error;
  }

  const admin = createAdminClient();
  const tokenUpdate = {
    access_token: encryptSecret(refreshed.access_token),
    expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    // Google が refresh token をローテートした場合は新しいトークンを保存します。
    // （refresh_token カラムは not null なので、値が返ってきたときだけ更新します）
    ...(refreshed.refresh_token
      ? { refresh_token: encryptSecret(refreshed.refresh_token) }
      : {}),
  };

  const { error: updateError } = await admin
    .from("gbp_connections")
    .update(tokenUpdate)
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);

  if (updateError) {
    // 記録しないと古い（期限切れの）トークンがDBに残り続けます。
    // 今回のリクエスト自体は新しいトークンで成功させても、
    // ログを残しておかないと失敗に気づけません。
    console.error(
      "Google連携のアクセストークンの保存に失敗しました" +
        "（DBには古いトークンのまま残っています）",
      updateError
    );
  }

  return refreshed.access_token;
}
