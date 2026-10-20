# 残タスク一覧（レビュー返信AI）

最終更新: 2026-10-20 / フェーズ1〜5の実装完了時点

## 現在地

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | Supabase Auth ログイン | ✅ 完了・動作確認済 |
| 2 | Stripe決済・サブスク状態更新 | ✅ 実装済（キー未設定で未検証） |
| 3 | 店舗設定（強み・SEOキーワード）／レビュー履歴UI | ✅ 完了・動作確認済 |
| 4 | Google Business Profile OAuth連携・レビュー取得 | ✅ 実装済（未検証） |
| 5 | OpenAI返信生成・Google APIへの投稿 | ✅ 実装済（未検証） |

実装済みだが**外部サービスの設定が必要で未検証**のものが残っています。

### 2026-10-20 追加実装（MVP必須3項目）

| 項目 | 状態 |
|---|---|
| 店舗設定「業種」（AIプロンプト反映） | ✅ 実装済 |
| 返信のON/Off切替（初期値OFF） | ✅ 実装済 |
| 自動返信バッチ（取得→生成→自動投稿） | ✅ 実装済 |
| 自動/手動の返信履歴の区別（`reviews.auto_replied`） | ✅ 実装済 |
| `vercel.json` のcron設定（1時間ごと） | ✅ 追加済 |
| **新マイグレーションの適用**（`category` / `auto_reply_enabled` / `auto_replied` 列） | ⬜ 要対応 |

---

## 1. Stripe（フェーズ2）— 決済フローの検証

- [ ] `STRIPE_SECRET_KEY` を `.env.local` に設定
- [ ] 月額プランを作成し `STRIPE_PRICE_ID` を設定
- [ ] Webhookエンドポイントを作成し `STRIPE_WEBHOOK_SECRET` を設定
- [ ] 契約 → 決済 → webhook反映 → 「契約中」バッジ まで通しで確認

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

**完了条件**: ダッシュボードのバッジが「未契約」→「契約中」に変わる

---

## 2. Google Business Profile（フェーズ4）— 連携とレビュー取得

- [ ] Google Cloud プロジェクトで **Business Profile APIs** を有効化
- [ ] OAuth 同意画面を構成し、Scopes に `https://www.googleapis.com/auth/business.manage` を追加
- [ ] OAuth クライアントID（ウェブアプリケーション）を作成
- [ ] 承認済みリダイレクトURI に `https://<本番ドメイン>/api/google/oauth/callback` を登録
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` を `.env.local` に設定
- [ ] `/settings` → 「Googleマップと連携する」→ 店舗が「連携済み」になることを確認
- [ ] 「レビューを取得する」でレビューが取得され `/reviews` に表示されることを確認
- [ ] 未返信レビューで「AI返信を作成して投稿」→ Googleマップへの掲載を確認
- [ ] **本番提供にはGoogleのアクセス承認（審査）が必要** → 審査申請を行う

> 審査前のプロジェクトでは自分のアカウントの店舗のみ認識されます。実店舗への提供開始は審査完了が前提です。

**完了条件**: 実店舗で 取得 → AI返信生成 → 投稿 まで通る

---

## 3. OpenAI（フェーズ5）— AI返信生成

- [ ] `OPENAI_API_KEY` を `.env.local` に設定
- [ ] 低評価（1〜3点）→ SEOキーワードが入らないこと
- [ ] 高評価（4〜5点）→ 設定したSEOキーワードが自然に混入すること
- [ ] キーワード未設定店舗でも自然な文章になること
- [ ] 業種が設定されているとき、その業種に合った言い回しになること

**完了条件**: 4点・2点のレビューで上記2条件を満たす返信が生成・投稿される

---

## 4. レビュー自動取得（運用）

- [ ] `CRON_SECRET` を `.env.local` に設定
- [ ] `/api/reviews/sync` を `Authorization: Bearer <CRON_SECRET>` で定期実行
  - `vercel.json` に `{"crons":[{"path":"/api/reviews/sync","schedule":"0 * * * *"}]}` を追加済み（Vercel CronはGETで、`Authorization: Bearer $CRON_SECRET` を自動送信する）
  - Vercel Hobbyプランは1日1回まで。1時間ごとの実行にはProプランが必要
- [ ] 店舗ごとの取得頻度を決める（推奨: 1〜2時間ごと）
- [ ] 自動返信ONの店舗で、取得→自動生成→自動投稿まで通ることを確認
- [ ] 自動返信OFFの店舗では自動投稿されないことを確認
- [ ] レビュー一覧で「AIが自動で作成した返信」/「AIが作成した返信」の表示が正しいこと

---

## 5. 本番デプロイ

- [ ] Vercel 等にプロジェクトを登録
- [ ] 環境変数を本番側で設定（`NEXT_PUBLIC_*`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, `GOOGLE_*`, `OPENAI_*`, `CRON_SECRET`）
- [ ] `supabase/setup-all.sql` を本番用Supabaseプロジェクトで実行
- [ ] `GOOGLE_TOKEN_ENCRYPTION_KEY` は本番・開発で**別の値**を生成する（開発時のままだとトークン復号に失敗する）
- [ ] Stripe Webhook のエンドポイントを本番ドメインに変更
- [ ] 確認: 未ログインリダイレクト／新規登録／設定保存／レビュー取得／決済

**注意**: 本番では Supabase の「Confirm email」をOFFのままにしない（未確認アカウントの攻撃リスクが増大）。開発時のみOFFにしてください。

---

## 6. テストデータの掃除

- [ ] 検証用アカウント `phase3-e2e@example.jp`（パスワード `TestPass123!`）を Supabase → Authentication → Users から削除
- [ ] 残留した `shop_settings` 行を削除（アカウント削除で自動削除される）
- [ ] 本番前に `reviews` / `gbp_connections` が空であることを確認

---

## 7. セキュリティ・運用

- [ ] `SUPABASE_SERVICE_ROLE_KEY` はサーバー専用。クライアントへ渡っていないことを再確認
- [ ] `GOOGLE_TOKEN_ENCRYPTION_KEY` をパスワードマネージャなどで管理（失うと再連携が必要）
- [ ] エラー監視（Vercel Logs / Sentry等）の導入
- [ ] 店舗ごとの「AI返信が自動投稿される」ことを店舗자에게事前周知（公開レビューになる点）
- [ ] 自動投稿ではなく「生成→確認→投稿」の2段階にする案も検討（誤投稿リスク回避）

---

## 8. フェーズ4/5の実機検証で，随時

- [ ] Google APIのレスポンスで想定外のフィールド（例: `reviewMediaItems` 付きレビュー）を確認
- [ ] 店舗が複数ある場合の表示と切り替え（現在は全店舗を自動登録）
- [ ] レビュー数が50件を超える場合のページング（現状は最新50件のみ取得）

---

## 完了確認コマンド

```bash
npm run lint
npm run build
```

---

## 参考: 開発環境メモ

- `next dev` は `http://127.0.0.1:3000` だと `allowedDevOrigins` 設定が無いとReactがハイドレーションされない（`next.config.ts` で設定済み）
- Supabaseは `example.com` などの予約ドメインを新規登録に拒否する（テスト時は実在ドメインを使う）
- DBマイグレーションは `supabase/setup-all.sql` をSQL Editorで実行すれば何度でも再実行できる
