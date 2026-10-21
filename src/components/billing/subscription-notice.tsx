import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 契約していない店舗に対して、使えない機能と次のアクションを明示します。
 */
export function SubscriptionNotice({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
        className
      )}
    >
      <div className="space-y-1">
        <p className="font-medium">月額プランが未契約です</p>
        <p>
          レビューの確認とAI返信の作成（下書き）は無料で使えます。
          Googleマップへの投稿と自動返信には月額プランのご契約が必要です。
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ size: "sm" })}>
        プランを契約する
      </Link>
    </div>
  );
}
