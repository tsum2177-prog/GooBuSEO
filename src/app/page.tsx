import Link from "next/link";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function Home() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl text-center">
        <p className="mb-4 text-sm font-medium text-muted-foreground">
          ローカル店舗向け Googleマップレビュー管理
        </p>
        <h1 className="text-4xl font-bold tracking-tight">レビュー返信AI</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          Googleマップの口コミに、AIが自動で丁寧な返信を作成。
          <br />
          低評価には誠実な対応案を、高評価には店舗の強みを自然に盛り込みます。
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {user ? (
            <Button size="lg" nativeButton={false} render={<Link href="/dashboard" />}>
              ダッシュボードへ
            </Button>
          ) : (
            <>
              <Button size="lg" nativeButton={false} render={<Link href="/signup" />}>
                無料で始める
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                ログイン
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
