"use client";

import { useActionState } from "react";
import { Unlink } from "lucide-react";
import {
  disconnectGoogleAction,
  type SettingsActionState,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

const initialState: SettingsActionState = { status: "success", message: "" };

export function DisconnectButton({
  connectionId,
}: {
  connectionId: string;
}) {
  const [state, formAction, pending] = useActionState(
    disconnectGoogleAction,
    initialState
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="connection_id" value={connectionId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Unlink />
        {pending ? "解除中..." : "連携を解除"}
      </Button>
      {state.message && (
        <span className="text-xs text-muted-foreground">{state.message}</span>
      )}
    </form>
  );
}
