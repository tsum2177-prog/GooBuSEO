import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const instant = false;

export default async function ErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold">認証エラー</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {reason === "confirm"
            ? "確認リンクが無効か、期限が切れています。もう一度ログインするか、新規登録をお試しください。"
            : "ログイン処理中にエラーが発生しました。もう一度お試しください。"}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className={buttonVariants({})}>
            ログインへ
          </Link>
          <Link href="/signup" className={buttonVariants({ variant: "outline" })}>
            新規登録
          </Link>
        </div>
      </div>
    </main>
  );
}
