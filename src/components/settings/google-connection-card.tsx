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
                  <span className="text-sm font-medium">
                    {location.title ?? location.id}
                  </span>
                  <DisconnectButton connectionId={location.id} />
                </li>
              ))}
            </ul>
            <form action={formAction} className="flex items-center gap-3">
              <Button type="submit" variant="outline" disabled={pending}>
                <RefreshCw />
                {pending ? "取得中..." : "レビューを取得する"}
              </Button>
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
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
