# レビュー返信AI

ローカル店舗向けの「Googleマップレビュー自動返信SaaS」。

## 技術スタック

- Next.js (App Router, TypeScript) + Tailwind CSS + shadcn/ui
- Supabase (Auth / DB)
- Stripe (月額課金)
- Google Business Profile API (レビュー取得・返信投稿)
- OpenAI API (返信文の自動生成)

## セットアップ

### 1. 環境変数

1. [supabase.com](https://supabase.com) で新規プロジェクトを作成
2. Project Settings → API から `Project URL` と `anon public` キーを取得
3. `.env.example` を `.env.local` にコピーし、実際の値を設定

```bash
cp .env.example .env.local
```

### 2. Supabase側の設定（メール確認）

開発時のみ: Authentication → Sign In / Providers → Email の **Confirm email を OFF** にすると確認メール不要で即ログインできます。

Confirm email を ON で使う場合は、Authentication → Email Templates → Confirm signup のURLを変更してください。

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

（デフォルトの `{{ .ConfirmationURL }}` のままでも `/auth/confirm?code=` 経由で動作します）

※ Supabaseは `example.com` などの予約ドメインを新規登録に拒否します。テスト時は実在するドメインのメールアドレスを使ってください。

### 3. データベース

Supabase の **SQL Editor** で、`supabase/migrations/` 以下のファイルを **順番に** 実行してください。

1. `supabase/migrations/20261019120000_create_profiles.sql`（profilesテーブル・RLS・新規ユーザー自動作成トリガー）
2. `supabase/migrations/20261020120000_create_shop_settings.sql`（店舗設定テーブル・RLS）
3. `supabase/migrations/20261020120100_create_reviews.sql`（レビュー履歴テーブル・RLS）
4. `supabase/migrations/20261020120200_create_gbp_connections.sql`（Google連携トークン保存テーブル・RLS）

順番どおりに実行してください（`set_updated_at` 関数は1つ目が作ります）。実行後、Table Editor に `profiles` / `shop_settings` / `reviews` / `gbp_connections` の4テーブルがあることを確認できます。

### 4. Stripe設定（月額課金）

1. Stripe Dashboard → Products で **月額プラン** を作成し、Price IDを取得（`price_...`）
2. Developers → API keys の **Secret key** を取得（`sk_test_...` / 本番は `sk_live_...`）
3. Developers → Webhooks でエンドポイントを作成
   - URL: `https://<your-domain>/api/stripe/webhook`
   - イベント: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Signing secret を取得（`whsec_...`）
4. `.env.local` に `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` を設定

ローカル開発時はStripe CLIで転送します。

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# 出力された whsec_... を .env.local の STRIPE_WEBHOOK_SECRET に設定
```

※ 環境変数が未設定の間はダッシュボードに「決済設定がまだ完了していないため、契約できません」と表示され、契約ボタンは出ません。

### 5. Googleマップ連携の設定（フェーズ4）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. APIs & Services → ライブラリ → **Business Profile APIs** を有効化
3. APIs & Services → 認証情報 → **OAuth 同意画面**を構成し、Scopes に `https://www.googleapis.com/auth/business.manage` を追加
4. 認証情報 → **OAuth クライアントID**（種類: ウェブアプリケーション）を作成
   - 承認済みリダイレクトURI: `http://localhost:3000/api/google/oauth/callback`（本番は https）
5. `.env.local` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` を設定
6. トークン暗号化キーを生成して `GOOGLE_TOKEN_ENCRYPTION_KEY` に設定

```bash
openssl rand -hex 32
```

> **注意**: Business Profile API を一般の店舗ユーザーに提供するには、Googleによるアクセス承認（審査）が必要です。審査前のPJでは自分のアカウントの店舗のみ認識されます。実店舗への提供開始は審査完了が前提です。

### 6. OpenAIの設定（フェーズ5）

1. [platform.openai.com](https://platform.openai.com/) でAPIキーを作成
2. `.env.local` に `OPENAI_API_KEY` を設定（モデル変更は `OPENAI_MODEL`、既定は `gpt-4o-mini`）

### 7. 起動

```bash
npm install
npm run dev
```

http://localhost:3000 を開く

## 検証手順

1. 未ログインで `/dashboard` `/settings` `/reviews` → `/login` へリダイレクトされること
2. `/signup` で新規登録 → ログイン → `/dashboard` が表示されること
3. ログアウト → `/dashboard` へ直接アクセスすると `/login` へ戻ること
4. `npm run build` がエラーなく通ること
5. ダッシュボードに「月額プラン」カードが表示され、ステータスが「未契約」バッジで見えること
6. （Stripe設定後）「月額プランを契約する」→ Checkout画面 → テストカード決済 → `/dashboard?checkout=success` へ戻り、webhook反映後に「契約中」バッジへ変わること
7. `/settings` で店舗名・強み・SEOキーワードを保存し、再読み込み後も保持されること
8. `/reviews` が表示され、レビューが0件のときは空状態案内になること
9. （Google設定後）`/settings` の「Googleマップと連携する」→ Googleの同意画面 → 戻ると店舗が「連携済み」になること
10. 「レビューを取得する」でレビューが取得され、`/reviews` に表示されること
11. 未返信のレビューで「AI返信を作成して投稿」→ Googleマップに返信が掲載され、レビュー一覧に「返信済み」と表示されること

## ディレクトリ構成

```
src/
├── proxy.ts                 # セッション更新とルート保護（Next.js 16のmiddleware後継）
├── lib/
│   ├── crypto.ts            # Googleトークンの暗号化（AES-256-GCM）
│   ├── openai.ts            # AI返信文の生成
│   ├── origin.ts            # リクエスト元のオリジン取得
│   ├── google/
│   │   ├── oauth.ts         # OAuth2.0（認証URL・コード交換・トークン更新）
│   │   ├── business.ts      # Business Profile API（店舗・レビュー取得・返信）
│   │   ├── connections.ts   # 連携情報の保存とアクセストークン管理
│   │   └── reviews.ts       # レビュー取得・DB同期
│   ├── supabase/
│   │   ├── client.ts        # ブラウザ用クライアント
│   │   ├── server.ts        # サーバー用クライアント
│   │   └── admin.ts         # Service Roleクライアント（webhook・Google連携用）
│   └── stripe.ts            # Stripeクライアント
├── components/
│   ├── ui/                  # shadcn/uiコンポーネント
│   ├── auth/                # ログイン・新規登録フォーム
│   ├── billing/plan-card.tsx # 月額プランカード（ステータス・契約/管理ボタン）
│   ├── settings/            # 店舗設定フォーム・Google連携カード
│   ├── reviews/             # レビュー履歴リスト・AI返信ボタン
│   └── app-header.tsx       # 認証後ヘッダー（ナビゲーション）
└── app/
    ├── page.tsx             # トップページ
    ├── (auth)/              # ログイン・新規登録
    ├── (app)/dashboard/     # 保護ページ（プランカード・店舗設定・最新レビュー）
    ├── (app)/settings/      # 店舗設定ページ + Server Actions
    ├── (app)/reviews/       # レビュー履歴ページ + Server Actions
    ├── (app)/billing/       # Checkout/Portal Server Actions
    ├── api/stripe/webhook/  # Stripe webhook（署名検証・ステータス更新）
    ├── api/google/oauth/    # Google OAuth 開始・コールバック
    ├── api/reviews/sync/    # レビュー一括取得（CRON_SECRETで認可）
    ├── auth/confirm/        # メール確認リンク処理
    └── error/               # 認証エラーページ
supabase/migrations/         # DBマイグレーションSQL
```

## 運用メモ

- **レビュー取得**: `/settings` の「レビューを取得する」で手動取得できます。自動取得する場合は `/api/reviews/sync` を `Authorization: Bearer <CRON_SECRET>` で定期実行（Vercel Cronなど）してください。
- **AI返信の投稿**: 低評価（1〜3点）は「謝罪・改善案のみ、SEOキーワードは入れない」、高評価（4〜5点）は「感謝 + SEOキーワードを自然に盛り込み」。生成した文はそのままGoogleマップへ投稿されます。
- **トークン管理**: Googleのアクセストークン・リフレッシュトークンは `GOOGLE_TOKEN_ENCRYPTION_KEY` で暗号化して保存しています。キーが変わると再連携が必要です。

## フェーズロードマップ

- **フェーズ1（完了）**: Next.js + shadcn/ui + Supabase Authログイン
- **フェーズ2（完了）**: Stripe決済・サブスク状態の更新（profilesテーブル・Checkout・webhook）
- **フェーズ3（完了）**: ダッシュボード（SEOキーワード設定・レビュー履歴）
- **フェーズ4（完了）**: Google Business Profile API OAuth連携・レビュー取得
- **フェーズ5（完了）**: OpenAI返信生成・Google APIへの返信投稿
