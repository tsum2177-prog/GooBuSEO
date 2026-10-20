"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  saveShopSettings,
  type SettingsActionState,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const MAX_KEYWORDS = 20;

const categories = [
  "飲食店",
  "居酒屋・バー",
  "喫茶店・カフェ",
  "美容院・理容店",
  "歯科医院・クリニック",
  "ホテル・旅館",
  "その他",
];

const initialState: SettingsActionState = { status: "success", message: "" };

export function ShopSettingsForm({
  initial,
}: {
  initial: {
    shopName: string;
    category: string;
    strengths: string;
    seoKeywords: string[];
    autoReplyEnabled: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState(
    saveShopSettings,
    initialState
  );
  const [keywords, setKeywords] = useState<string[]>(initial.seoKeywords);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState(initial.category);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(
    initial.autoReplyEnabled
  );

  function addKeyword() {
    const value = draft.trim();
    if (!value) return;
    setKeywords((current) =>
      current.includes(value) || current.length >= MAX_KEYWORDS
        ? current
        : [...current, value]
    );
    setDraft("");
  }

  function removeKeyword(value: string) {
    setKeywords((current) => current.filter((keyword) => keyword !== value));
  }

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>店舗情報</CardTitle>
          <CardDescription>
            AIが返信文を作るときに使われる店舗名と業種です
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shop_name">店舗名</Label>
            <Input
              id="shop_name"
              name="shop_name"
              defaultValue={initial.shopName}
              placeholder="例: 炭火焼肉 ambi"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category_select">業種</Label>
            <Select
              value={category || null}
              onValueChange={(value) => setCategory(value ?? "")}
            >
              <SelectTrigger id="category_select" className="w-full">
                <SelectValue placeholder="業種を選択してください" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="category" value={category} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>店舗の強み</CardTitle>
          <CardDescription>
            返信文に自然に反映される店舗の特徴です。具体的な特徴を書いてください
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="strengths">店舗の強み</Label>
          <Textarea
            id="strengths"
            name="strengths"
            defaultValue={initial.strengths}
            placeholder="例: 新宿駅徒歩3分、少人数向けの個室が10室あります。接待や誕生日祝いにも対応しています。"
            rows={5}
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            箇条書きでもかまいません。例:「駅近」「個室」「深夜営業」
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SEOキーワード</CardTitle>
          <CardDescription>
            高評価のレビューへの返信に、自然に盛り込みます
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="seo_keyword_input">キーワードを追加</Label>
          <div className="flex gap-2">
            <Input
              id="seo_keyword_input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="例: 新宿"
              maxLength={30}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addKeyword}
              disabled={!draft.trim() || keywords.length >= MAX_KEYWORDS}
            >
              <Plus />
              追加
            </Button>
          </div>
          <input type="hidden" name="seo_keywords" value={keywords.join(",")} />
          {keywords.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {keywords.map((keyword) => (
                <li key={keyword}>
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
                    {keyword}
                    <button
                      type="button"
                      onClick={() => removeKeyword(keyword)}
                      aria-label={`${keyword}を削除`}
                      className="rounded-full p-0.5 hover:bg-background/60"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              まだキーワードがありません。例: 新宿、焼肉、個室
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>自動返信</CardTitle>
          <CardDescription>
            新しく取得したレビューへ自動で返信するかどうか
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="auto_reply_switch">自動返信をONにする</Label>
              <p className="text-sm text-muted-foreground">
                ONにすると、取得したレビューに自動で返信を投稿します。
                OFFの場合でも、レビュー一覧から手動で投稿できます。
              </p>
            </div>
            <Switch
              id="auto_reply_switch"
              checked={autoReplyEnabled}
              onCheckedChange={(checked) => setAutoReplyEnabled(checked)}
            />
          </div>
          <input
            type="hidden"
            name="auto_reply_enabled"
            value={autoReplyEnabled ? "on" : "off"}
          />
          <p className="text-xs text-muted-foreground">
            自動返信は店舗名義の公開レビューとして投稿され、外からご覧いただけます。
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "保存中..." : "保存する"}
        </Button>
        {state.message && (
          <p
            role="status"
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
