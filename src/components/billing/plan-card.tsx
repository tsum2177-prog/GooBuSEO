import { createCheckoutSession, createPortalSession } from "@/app/(app)/billing/actions";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SubscriptionStatus } from "@/lib/billing";
import { fetchPriceLabel, isStripeConfigured } from "@/lib/stripe";
import type { VariantProps } from "class-variance-authority";

export type { SubscriptionStatus };

type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>;

const statusMeta: Record<
  SubscriptionStatus,
  { label: string; variant: BadgeVariant }
> = {
  none: { label: "未契約", variant: "secondary" },
  active: { label: "契約中", variant: "default" },
  past_due: { label: "支払いエラー", variant: "destructive" },
  canceled: { label: "解約済み", variant: "outline" },
};

export async function PlanCard({
  status,
}: {
  status: SubscriptionStatus;
}) {
  const configured = isStripeConfigured();
  const priceLabel = configured ? await fetchPriceLabel() : null;
  const meta = statusMeta[status];
  const hasActiveSubscription = status === "active" || status === "past_due";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>月額プラン</CardTitle>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <CardDescription>
          レビュー自動返信 月額サブスクリプション
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">
          {priceLabel ?? "—"}
          {priceLabel && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              / 月（税込）
            </span>
          )}
        </p>
        {!configured && (
          <p className="mt-2 text-sm text-muted-foreground">
            決済設定がまだ完了していないため、契約できません。
          </p>
        )}
      </CardContent>
      <CardFooter>
        {configured &&
          (hasActiveSubscription ? (
            <form action={createPortalSession}>
              <Button type="submit">プランを管理する</Button>
            </form>
          ) : (
            <form action={createCheckoutSession}>
              <Button type="submit">月額プランを契約する</Button>
            </form>
          ))}
      </CardFooter>
    </Card>
  );
}
