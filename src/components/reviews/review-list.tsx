import { Star } from "lucide-react";
import { ReplyButton } from "@/components/reviews/reply-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ReviewItem = {
  id: string;
  author_name: string | null;
  rating: number;
  content: string | null;
  published_at: string | null;
  reply_text: string | null;
  replied_at: string | null;
  auto_replied: boolean;
  posted_via: string | null;
  created_at: string;
};

/**
 * 返信の出所を返します。
 *
 * `posted_via` が無い（取得で同期したもの）場合、AIが書いたかは判断できないので
 * ラベルを出さず、誤って「AIが作成した返信」と呼ばないようにします。
 * 旧データは `auto_replied` から復元します。
 */
function replySourceLabel(review: {
  posted_via: string | null;
  auto_replied: boolean;
}): string | null {
  if (review.posted_via === "ai_auto") return "AIが自動で作成した返信";
  if (review.posted_via === "ai_manual") return "AIが作成した返信";
  return review.auto_replied ? "AIが自動で作成した返信" : null;
}

export function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`5段階中${rating}点`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden="true"
          className={cn(
            "size-4",
            value <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          )}
        />
      ))}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(date);
}

export function ReviewList({
  reviews,
  canGenerate = true,
  canPost = true,
}: {
  reviews: ReviewItem[];
  /** AI返信の作成（下書き）ができるか */
  canGenerate?: boolean;
  /** Googleマップへ投稿できるか */
  canPost?: boolean;
}) {
  if (reviews.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>まだレビューがありません</CardTitle>
          <CardDescription>
            Googleマップ連携が完了すると、ここに取得したレビューが一覧表示されます。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => {
        const replied = Boolean(review.reply_text);
        return (
          <li key={review.id}>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StarRating rating={review.rating} />
                      <span className="font-medium">
                        {review.author_name ?? "名前のないお客様"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(review.published_at ?? review.created_at)}
                    </p>
                  </div>
                  <Badge variant={replied ? "secondary" : "outline"}>
                    {replied ? "返信済み" : "未返信"}
                  </Badge>
                </div>
                {review.content && (
                  <p className="leading-relaxed">{review.content}</p>
                )}
                {review.reply_text && (
                  <div className="space-y-1 border-l-2 border-border pl-3">
                    {replySourceLabel(review) && (
                      <p className="text-xs font-medium text-muted-foreground">
                        {replySourceLabel(review)}
                      </p>
                    )}
                    <p className="text-sm leading-relaxed">{review.reply_text}</p>
                  </div>
                )}
                {!replied &&
                  (canGenerate ? (
                    <ReplyButton reviewId={review.id} mode={canPost ? "post" : "draft"} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Googleマップと連携すると、AI返信を作成できます。
                    </p>
                  ))}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
