import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "#feature", label: "書き分け" },
  { href: "#howto", label: "使い方" },
  { href: "#pricing", label: "料金" },
  { href: "#faq", label: "よくある質問" },
];

export function SiteHeader({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <MessageSquareReply className="size-4.5" aria-hidden="true" />
          </span>
          <span className="text-[15px]">レビュー返信AI</span>
        </Link>

        <nav
          aria-label="ページ内ナビゲーション"
          className="hidden items-center gap-7 md:flex"
        >
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              ダッシュボードへ
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="hidden sm:inline-flex"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                ログイン
              </Button>
              <Button
                size="lg"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                nativeButton={false}
                render={<Link href="/signup" />}
              >
                無料で始める
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
