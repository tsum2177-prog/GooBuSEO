"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import {
  generateAndPostReply,
  type ReplyActionState,
} from "@/app/(app)/reviews/actions";
import { Button } from "@/components/ui/button";

const initialState: ReplyActionState = { status: "success", message: "" };

export function ReplyButton({ reviewId }: { reviewId: string }) {
  const [state, formAction, pending] = useActionState(
    generateAndPostReply,
    initialState
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="review_id" value={reviewId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Sparkles />
        {pending ? "作成中..." : "AI返信を作成して投稿"}
      </Button>
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
