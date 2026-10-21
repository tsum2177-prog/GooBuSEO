"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import {
  generateAndPostReply,
  generateReplyDraft,
  type ReplyActionState,
} from "@/app/(app)/reviews/actions";
import { Button, buttonVariants } from "@/components/ui/button";

const initialState: ReplyActionState = { status: "success", message: "" };

export function ReplyButton({
  reviewId,
  mode = "post",
}: {
  reviewId: string;
  /** post: 生成してすぐ投稿 / draft: 下書きのみ作成 */
  mode?: "post" | "draft";
}) {
  const [state, formAction, pending] = useActionState(
    mode === "draft" ? generateReplyDraft : generateAndPostReply,
    initialState
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="review_id" value={reviewId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Sparkles />
        {pending
          ? "作成中..."
          : mode === "draft"
            ? "AI返信を作成（下書き）"
            : "AI返信を作成して投稿"}
      </Button>
      {state.draft && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">下書き</p>
          <p className="text-sm leading-relaxed">{state.draft}</p>
          <Link
            href="/dashboard"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            月額プランを契約して投稿する
          </Link>
        </div>
      )}
      {state.message && (
        <p
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
