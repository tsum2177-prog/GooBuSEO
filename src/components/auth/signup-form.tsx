"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    setLoading(false);

    if (signUpError) {
      if (signUpError.code === "weak_password") {
        setError("パスワードは6文字以上で入力してください。");
      } else if (signUpError.code === "user_already_exists") {
        setError("このメールアドレスは既に登録されています。");
      } else if (signUpError.code === "email_rate_limit_exceeded") {
        setError(
          "メール送信回数の上限に達しました。しばらくして再度お試しください。"
        );
      } else {
        setError("登録に失敗しました。時間をおいて再度お試しください。");
      }
      return;
    }

    if (data.session) {
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>確認メールを送信しました</CardTitle>
          <CardDescription>
            {email} 宛に確認リンクをお送りしました。メール内のリンクをクリックするとログインできます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className={buttonVariants({ className: "w-full" })}>
            ログインへ
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>新規登録</CardTitle>
        <CardDescription>
          メールアドレスとパスワードでアカウントを作成します
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <GoogleSignInButton label="Googleで始める" />
          <div className="relative text-center text-xs text-muted-foreground">
            <span className="bg-card px-2">または</span>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="shop@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                placeholder="6文字以上"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "アカウント作成中..." : "アカウント作成"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            既にアカウントをお持ちの方は{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              ログイン
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
