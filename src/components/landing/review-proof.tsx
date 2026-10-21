import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProofReview = {
  rating: number;
  reviewer: string;
  publishedAt: string;
  body: string;
  reply: string;
  replyLabel: string;
  /** SEOキーワード。返信文の中で該当箇所を強調表示します */
  keywords?: string[];
};

function Stars({ rating }: { rating: number }) {
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

function highlightKeywords(text: string, keywords: string[]) {
  const targets = keywords.filter((keyword) => keyword.length > 0);
  if (targets.length === 0) return text;

  const escaped = targets.map((keyword) =>
    keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`(${escaped.join("|")})`, "g");

  return text.split(pattern).map((part, index) =>
    targets.includes(part) ? (
      <mark
        key={index}
        className="rounded-sm bg-brand-muted px-1 py-px font-medium text-brand"
      >
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

export function ReviewProof({
  review,
  className,
}: {
  review: ProofReview;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-foreground/5",
        className
      )}
    >
      <figcaption className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">
          Googleマップのレビュー
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {review.publishedAt}
        </span>
      </figcaption>

      <div className="mt-3 flex items-center gap-2">
        <Stars rating={review.rating} />
        <span className="text-sm font-medium">{review.reviewer}</span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-foreground/90">
        {review.body}
      </p>

      <div className="mt-4 space-y-1.5 border-l-2 border-brand pl-3">
        <p className="text-xs font-medium text-brand">{review.replyLabel}</p>
        <p className="text-sm leading-relaxed">
          {highlightKeywords(review.reply, review.keywords ?? [])}
        </p>
      </div>
    </figure>
  );
}
