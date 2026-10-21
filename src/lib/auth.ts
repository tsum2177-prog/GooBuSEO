import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * 認証済みユーザーの取得。
 *
 * React.cache() により、リクエスト内では1回だけ実行されます。
 * レイアウトとページがそれぞれ `getUser()` を呼んでも、
 * Supabase Auth への通信は1回にまとめられます。
 *
 * ※ Reactの描画コンテキストの外（Server Actionなど）では
 *   メモ化されずにそのまま実行されます。
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
