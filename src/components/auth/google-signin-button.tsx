"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Googleアカウントでサインインするボタン。
 *
 * 認証後の戻り先は既存の /auth/confirm を使います（codeを受け取って
 * セッションを交換するルートが既にあるため）。
 */
export function GoogleSignInButton({
  label = "Googleで始める",
}: {
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    // 成功時はGoogleの画面へ遷移するので、ここには戻らない
    if (signInError) {
      setError(
        "Googleでのサインインに失敗しました。時間をおいて再度お試しください。"
      );
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? "Googleへ移動しています..." : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
