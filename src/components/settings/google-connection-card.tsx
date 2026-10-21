"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import {
  syncReviewsAction,
  type SettingsActionState,
} from "@/app/(app)/settings/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DisconnectButton } from "@/components/settings/disconnect-button";

export type ConnectedLocation = {
  id: string;
  title: string | null;
  status: "active" | "revoked";
};

const initialState: SettingsActionState = { status: "success", message: "" };

export function GoogleConnectionCard({
  locations,
  googleConfigured,
}: {
  locations: ConnectedLocation[];
  googleConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    syncReviewsAction,
    initialState
  );

  const revokedCount = locations.filter(
    (location) => location.status === "revoked"
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Googleマップ連携</CardTitle>
          <Badge variant={locations.length > 0 ? "secondary" : "outline"}>
            {locations.length > 0 ? "連携済み" : "未連携"}
          </Badge>
        </div>
        <CardDescription>
          店舗プロフィールを連携すると、レビューを自動で取得できます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {revokedCount > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <p className="font-medium">Google連携の権限が失効しています</p>
            <p className="mt-1">
              {revokedCount}件の店舗でアクセス権が失効しました。
              下の「Googleマップと連携する」からGoogleに再ログインすると、
              連携が更新されます。リンクできる店舗に無い場合は「連携を解除」で削除してください。
            </p>
          </div>
        )}
        {!googleConfigured ? (
          <p className="text-sm text-muted-foreground">
            Google連携用の設定がまだ完了していません。管理者による設定が必要です。
          </p>
        ) : locations.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              連携すると、お店のGoogleマッププロフィールをこのアプリで管理できます。
            </p>
            <a
              href="/api/google/oauth/start"
              className={buttonVariants({ className: "inline-flex" })}
            >
              Googleマップと連携する
            </a>
          </>
        ) : (
          <>
            <ul className="space-y-3">
              {locations.map((location) => (
                <li
                  key={location.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {location.title ?? location.id}
                    {location.status === "revoked" && (
                      <Badge variant="destructive">再連携が必要</Badge>
                    )}
                  </span>
                  <DisconnectButton connectionId={location.id} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/api/google/oauth/start"
                className={buttonVariants({ variant: "outline", className: "inline-flex" })}
              >
                Googleマップと再連携する
              </a>
              <form action={formAction} className="flex items-center gap-3">
                <Button type="submit" variant="outline" disabled={pending}>
                  <RefreshCw />
                  {pending ? "取得中..." : "レビューを取得する"}
                </Button>
              </form>
            </div>
            {state.message && (
              <span
                className={
                  state.status === "error"
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {state.message}
              </span>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
