import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">ページが見つかりません</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonVariants({})}>
          トップページへ
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          ダッシュボードへ
        </Link>
      </div>
    </main>
  );
}
