"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">エラーが発生しました</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          ページの表示に失敗しました。もう一度お試しください。
          <br />
          続く場合はお問い合わせください。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>もう一度試す</Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          ダッシュボードへ
        </Link>
      </div>
    </div>
  );
}
