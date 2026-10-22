# レビュー返信AI

ローカル店舗向けの「Googleマップのレビュー自動返信SaaS」。

Googleマップのレビューを1時間ごとに取得し、評価点に応じてAIが返信文を書いて
Googleマップへ投稿する。店舗はGoogleマップと接続するだけで、返信作成は自動化できる。

| | |
|---|---|
| 対象ユーザー | 飲食店・美容院・歯科医院など、Googleマップで営業する個人店舗 |
| 主な機能 | Google Business Profile連携、レビュー取得、AI返信生成、返信の自動投稿、月額課金 |
| 技術スタック | Next.js 16 (App Router) / TypeScript / Tailwind CSS v4 / shadcn/ui / Supabase / Stripe / Gemini / Cloudflare Workers (OpenNext) |

- 店舗利用者向けの操作説明 → [`docs/manual.md`](docs/manual.md)
- 残タスクと未検証項目 → [`todolist.md`](todolist.md)

---

## 目次

1. [機能一覧](#1-機能一覧)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [データモデル](#3-データモデル)
4. [API リファレンス](#4-api-リファレンス)
5. [AIの返信生成仕様](#5-aiの返信生成仕様)
6. [セットアップ](#6-セットアップ)
7. [デプロイ（Cloudflare Workers）](#7-デプロイcloudflare-workers)
8. [検証手順](#8-検証手順)
9. [ディレクトリ構成](#9-ディレクトリ構成)
10. [運用メモ](#10-運用メモ)
11. [既知の制約](#11-既知の制約)
12. [セキュリティと CI](#12-セキュリティと-ci)

---

## 1. 機能一覧

| 機能 | 実装場所 |
|---|---|
| メール+パスワードの認証（Supabase Auth） | `src/app/(auth)/` |
| Googleアカウントでのサインイン（Supabase AuthのGoogle provider） | `src/components/auth/google-signin-button.tsx` |
| 月額サブスク（Stripe Checkout + Webhook） | `src/app/(app)/billing/actions.ts`, `src/app/api/stripe/webhook/route.ts` |
| ダッシュボード（プラン・店舗設定・最新レビュー） | `src/app/(app)/dashboard/page.tsx` |
| 店舗設定（店舗名・業種・強み・SEOキーワード・自動返信ON/OFF） | `src/app/(app)/settings/` |
| 月額サブスクによる機能の制限（契約状態によるゲーティング） | `src/lib/billing.ts` |
| 店舗名・業種の自動投入（Googleマップから取得） | `src/lib/shop-settings.ts`, `src/lib/shop-categories.ts` |
| Google Business Profile OAuth連携（複数店舗を自動登録） | `src/app/api/google/oauth/`, `src/lib/google/oauth.ts` |
| レビュー取得（1時間ごとのcron + 手動実行） | `src/app/api/reviews/sync/route.ts`, `src/lib/google/reviews.ts` |
| AI返信生成（Gemini / `gemini-3.5-flash-lite`） | `src/lib/ai.ts` |
| 返信の自動投稿・手動投稿 | `src/lib/google/auto-reply.ts`, `src/app/(app)/reviews/actions.ts` |
| 返信の品質チェック（日本語・長さ・URL・電話番号・レビュー依頼の除外） | `src/lib/ai.ts` |
| 投稿前の既存返信チェック（二重投稿の防止） | `src/lib/google/business.ts`, `src/lib/google/auto-reply.ts` |
| Google API のエラー分類と再試行（429 / 5xx / 401） | `src/lib/google/api-error.ts`, `src/lib/google/business.ts` |
| アプリ全体のセキュリティヘッダー | `next.config.ts` |
| CI（lint / typecheck / build） | `.github/workflows/ci.yml` |
| 公開ランディングページ | `src/app/page.tsx` |

---

## 2. アーキテクチャ

### レイヤー構成

```
ブラウザ
  │
  ├─ Supabase SSR（Cookieセッション）
  │    ├─ /login, /signup      認証フォーム
  │    └─ /dashboard, /settings, /reviews
  │         └─ Server Actions / Server Components
  │
  ├─ Stripe                     Checkout / Billing Portal / Webhook
  ├─ Google Business Profile API  レビュー取得・返信投稿
  └─ Gemini API                 返信文生成
```

### 処理の流れ（レビュー取得 → 返信投稿）

```
Cloudflare Cron（1時間ごと）
  └─ worker.ts  scheduled handler
       └─ GET /api/reviews/sync   （Authorization: Bearer $CRON_SECRET）
            ├─ service role クライアントで全ユーザーを列挙
            └─ ユーザーごとに
                 ├─ syncReviews(userId)
                 │    ├─ GBP API から最新200件まで取得（`nextPageToken` を回して全ページ）
                 │    └─ reviews へ upsert（onConflict: user_id,external_id）
                 └─ autoReplyPendingReviews(userId)
                      ├─ shop_settings.auto_reply_enabled が true のときのみ
                      ├─ reply_text が null のレビューを published_at 順に処理
                      │   （auto_reply_attempts が上限に達したレビューは除外）
                      ├─ generateReply() → Gemini
                      ├─ Googleマップ上に既存の返信が無いか確認 → あれば投稿せず取り込み
                      ├─ replyToReview() → GBP API（PUT /{review}/reply）
                      └─ reviews を更新（reply_text / replied_at / auto_replied=true）
```

手動実行も同じ処理を通ります。
`src/app/(app)/settings/actions.ts` の `syncReviewsAction` → `syncReviews` + `autoReplyPendingReviews`。

### 自動返信の冪等性（同じレビューへ二重に投稿しない仕組み）

返信は**店舗名義の公開レビュー**としてGoogleマップに残るため、生成と投稿は
一度しか行われないことを保証します。2つの層で守っています。

**1. アプリ層 — 返信履歴を消さない / 排他的に確保する**

- `src/lib/google/reviews.ts` は、GBPの応答に `reviewReply` が含まれない場合に
  ローカル保存済みの `reply_text` / `replied_at` を**上書きせず持ち越します**。
  これをしないと「未返信」と判定され、同じレビューへ別の文章で再投稿されます。
- `src/lib/review-claims.ts` の `claimReviews()` は、処理対象の行に `claimed_at` と
  `claimed_by`（実行固有のID）を条件付きUPDATEで設定して確保します。同時実行しても
  同じ行を確保できるのは一方だけです。30分以上取り残されたclaimは次の実行で回収します
  （自分が今回確保した行は、回収の対象から外します）。
- 手動投稿（`src/app/(app)/reviews/actions.ts`）も、返信済みレビューを拒否し、
  投稿前に同じclaimを取得します。
- どちらの経路も、投稿の直前にGoogleマップ上の返信を読み、既にある場合は投稿しません。

**2. DB層 — トリガーで強制する**

- `reviews_preserve_reply` トリガー（マイグレーション
  `20261020120400_add_claim_and_preserve_reply.sql`）が、更新時に
  `reply_text` が `NULL` へ変わろうとした場合に旧値へ戻します。
  アプリ層で漏れた経路でも、公開済み返信が失われることはありません。

> `claimed_at` カラムは同マイグレーション、`claimed_by` カラムは
> `20261021120000_add_claimed_by.sql` で追加します。
> `claimed_by` が未適用の環境では `claimed_at` のみで排他が働きます（ログに警告が出ます）。
> `claimed_at` すら未適用の場合は排他制御が無効ですが、自動返信自体は動作し続けます
> （ログに警告が出ます）。

### 連携エラーの分離と失効トークンの扱い

1店舗へのGoogle連携が壊れても、ほかの店舗や自動返信が止まってはいけません。

| 段階 | 処理 |
|---|---|
| 店舗ごとの取得 | `syncReviews()` は接続単位で try/catch します。失敗した店舗は `failures` に記録され、残りの店舗は処理が続行されます |
| 取得と自動返信の分離 | cron（`/api/reviews/sync`）と「レビューを取得する」は、取得が失敗しても自動返信の処理を必ず実行します |
| 一時的な失敗 | 429（クォータ超過）と5xxは最大3回、指数バックオフ（500ms → 1000ms → 2000ms）で再試行します。`Retry-After` ヘッダがあればその秒数を優先します |
| トークンの失効 | Googleのトークン更新が `invalid_grant`（権限解除・失効）を返すと、その連携を `status='revoked'` として保存し、以後の処理対象から外します |
| API が 401 を返す | トークンが有効でもGBP APIだけが401を返す場合（Google側で権限が外れたとき）は、その連携を `status='revoked'` として保存し、以後の処理対象から外します |
| 失効した連携の通知 | `/settings` に「Google連携の権限が失効しています」の案内と「再連携が必要」バッジを表示します。再度連携すると `status` は `active` に戻ります |
| 自動返信のトークン取得 | 店舗ごとに1回だけアクセストークンを取得します。取得に失敗した店舗は、その/reviewsだけ処理しません |

> `status` カラムはマイグレーション `20261020120500_add_connection_status.sql` で追加します。
> 未適用の環境でも処理は続行しますが、失効した連携は毎回同じトークンを試すことになります。

### 課金のゲート（誰が有料機能を使えるか）

Googleマップの**連携**があれば、レビュー取得・閲覧とAI返信の**下書き作成**までは
無料で使えます。Googleマップへの**投稿**と**自動返信**は、**月額サブスクリプションの契約中のみ**
利用できます。判定は `src/lib/billing.ts` の `getAccessLevel()` に集約しています。

| 契約状態 | レビュー取得・下書き | 投稿・自動返信 | 備考 |
|---|---|---|---|
| `active` | 可 | 可 | 正常な契約中 |
| `past_due` | 可 | 可 | Stripeが支払いを再回収中の猶予。Stripeが`canceled`にするまでは許可 |
| `none` | Google連携があれば可（1店舗まで） | 不可 | 未契約 |
| `canceled` | Google連携があれば可（1店舗まで） | 不可 | 解約済み |

```ts
// src/lib/billing.ts
export async function getAccessLevel(userId: string): Promise<AccessLevel>
export async function isSubscribed(userId: string): Promise<boolean>
export function isAccessibleStatus(status: SubscriptionStatus): boolean
```

ゲートしている箇所:

| 箇所 | 対象 | ゲート |
|---|---|---|
| `src/lib/google/reviews.ts` `syncReviews()` | レビュー取得 | `canReadReviews` / `maxLocations` |
| `src/lib/google/auto-reply.ts` `autoReplyPendingReviews()` | AI返信の自動生成・投稿 | `canAutoReply` |
| `src/app/(app)/reviews/actions.ts` `generateAndPostReply()` | 手動での返信投稿 | `canPostReplies` |
| `src/app/(app)/reviews/actions.ts` `generateReplyDraft()` | 下書き生成 | `canGenerateReplies` |
| `src/app/(app)/settings/actions.ts` `syncReviewsAction()` | 「レビューを取得する」ボタン | `canReadReviews` |

未契約時はライブラリ層では静かに何もしない（cronのログを汚さないため）、
Server Actionでは利用者に分かるメッセージを返します。
契約状態の読み取りに失敗した場合は**fail-closed**（未契約として扱う）にしています。

### 認証の解決方法

`supabase.auth.getUser()` はCookieのトークンを検証するため、**ネットワークを1回往復**します。
同じリクエストで何度も呼ばないよう、`src/lib/auth.ts` の `getUser()` を使います。

```ts
// React.cache() により、リクエスト内では1回だけ実行される
export const getUser = cache(async (): Promise<User | null> => { ... });
```

レイアウトとページがそれぞれ `getUser()` を呼んでも、認証APIへの通信は1回にまとめられます。
`src/proxy.ts` はセッションの更新（Cookieの書き換え）を担うため、リクエストごとに1回
`getUser()` を実行します。Stripe webhookとレビュー同期APIはCookieセッションを使わないため、
proxyのmatcherから除外しています。

### Supabaseクライアントの使い分け

| ファイル | 役割 | RLS |
|---|---|---|
| `src/lib/supabase/client.ts` | ブラウザ用。ログイン・ログアウト | ユーザー権限で実行 |
| `src/lib/supabase/server.ts` | Server Components / Server Actions 用。Cookieでセッションを読み書き | ユーザー権限で実行 |
| `src/lib/supabase/admin.ts` | Service Role。Webhook・GBP接続情報・レビュー同期・自動返信 | **RLSを迂回** |

> **原則**: データベースへの書き込みのうち、`reviews` と `gbp_connections` は
> すべてservice roleクライアント経由です。ユーザー操作で直接書き込むのは
> `shop_settings` のみで、こちらはRLSのinsert/updateポリシーに依存しています。

### 認証とルート保護

| レイヤー | 役割 |
|---|---|
| `src/proxy.ts`（Next.js 16 の middleware 後継） | リクエストごとのセッション更新。`/dashboard` は未ログイン時に`/login`へ、`/login`・`/signup`はログイン済みで`/dashboard`へ |
| `src/app/(app)/layout.tsx` | `(app)` 配下の全ページで未ログインを検出して`/login`へリダイレクト |

---

## 3. データモデル

テーブルは4つ。すべて `auth.users(id)` を外部キーとして持ち，用户削除でカスケード削除されます。

### `profiles` — 契約状態

| カラム | 型 | 制約 |
|---|---|---|
| `id` | uuid | PK / `auth.users(id)` へのFK |
| `email` | text | |
| `subscription_status` | text | NOT NULL, default `'none'`, CHECK (`none` / `active` / `past_due` / `canceled`) |
| `stripe_customer_id` | text | UNIQUE |
| `stripe_price_id` | text | |
| `stripe_event_created_at` | timestamptz | 遅れて届いた古いイベントで上書きしないための時刻 |
| `created_at` / `updated_at` | timestamptz | NOT NULL, default `now()` |

`auth.users` への insert をトリガーに `handle_new_user()` が profiles 行を自動作成します。

### `stripe_events` — 処理済みイベント

| カラム | 型 | 制約 |
|---|---|---|
| `id` | text | PK。StripeのイベントID |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `processed_at` | timestamptz | 処理が成功した時刻。NULL のままなら「未処理」 |
| `attempts` | integer | NOT NULL, default `0`。処理に失敗した回数（再送のたびに増える） |

RLSを有効にしたままポリシーを持たせています。service role 経由でしか読み書きできません。

> 旧実装で記録済みの行は、`20261021100000_add_stripe_event_processing.sql` により
> 「処理済み」（`processed_at` に `created_at` を設定）として扱われます。

### `shop_settings` — 店舗ごとの設定（ユーザー1行）

| カラム | 型 | 制約 |
|---|---|---|
| `id` | uuid | PK / `auth.users(id)` へのFK |
| `shop_name` | text | |
| `category` | text | 業種（飲食店・居酒屋・バー・喫茶店・カフェ・美容院・理容店・歯科医院・クリニック・ホテル・旅館・その他） |
| `strengths` | text | NOT NULL, default `''` |
| `seo_keywords` | text[] | NOT NULL, default `'{}'`（最大20個） |
| `auto_reply_enabled` | boolean | NOT NULL, default `false` |
| `created_at` / `updated_at` | timestamptz | NOT NULL, default `now()` |

### `reviews` — 取得したレビューと返信履歴

| カラム | 型 | 制約 |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `user_id` | uuid | NOT NULL / `auth.users(id)` へのFK |
| `location_id` | text | GBPのロケーション名 |
| `external_id` | text | NOT NULL, GBPのレビューID。**UNIQUE (`user_id`, `external_id`)** |
| `author_name` | text | 名前のないレビューは null |
| `rating` | integer | NOT NULL, CHECK (1〜5) |
| `content` | text | |
| `published_at` | timestamptz | |
| `reply_text` | text | |
| `replied_at` | timestamptz | |
| `auto_replied` | boolean | NOT NULL, default `false`。手動=false / 自動=true |
| `posted_via` | text | CHECK (`ai_manual` / `ai_auto`)。AIが投稿したかを示す。NULL は取得で同期したもの（出所が分からない） |
| `claimed_at` | timestamptz | 自動返信の排他制御用。処理対象の行を条件付きUPDATEで確保し、同時実行による二重投稿を防ぐ |
| `claimed_by` | text | 自動返信の排他制御用。確保した実行の固有ID。`claimed_at` だけでは「誰が確保したか」が分からず、実行中の処理が回収対象になるため、確保した所有者を記録する |
| `auto_reply_attempts` | integer | NOT NULL, default `0`。自動返信の試行回数。上限（5回）に達したレビューは自動返信の対象から外す（他のレビューに処理枠を回すため） |
| `created_at` | timestamptz | NOT NULL, default `now()` |

インデックス: `(user_id, published_at desc)`, `(user_id, claimed_at)`, `(user_id, auto_reply_attempts)`

### `gbp_connections` — Google連携トークン

| カラム | 型 | 制約 |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `user_id` | uuid | NOT NULL / `auth.users(id)` へのFK |
| `google_account_id` | text | NOT NULL |
| `google_account_name` | text | |
| `location_id` | text | NOT NULL。**UNIQUE (`user_id`, `location_id`)** |
| `location_title` | text | |
| `access_token` | text | NOT NULL。**AES-256-GCMで暗号化済み** |
| `refresh_token` | text | NOT NULL。**AES-256-GCMで暗号化済み** |
| `expires_at` | timestamptz | NOT NULL |
| `status` | text | NOT NULL, default `'active'`, CHECK (`active` / `revoked`)。`revoked` は権限が失効した連携 |
| `created_at` / `updated_at` | timestamptz | NOT NULL, default `now()` |

### 連携トークンの列権限

`gbp_connections` は **列単位のGRANT** で、ユーザー権限からはトークン列を読み出せないよう
制限しています（マイグレーション `20261020120600`）。アプリは service role クライアント
経由でしか読み書きしていません。

### Stripe webhook の冪等性

Stripe は一度以上送信してきます（at-least-once）。対応は3段構えです。

| 対策 | 実装 |
|---|---|
| 重複処理の遮断 | イベントIDを `stripe_events` に記録し、**処理が成功したあと**に `processed_at` を設定します。`processed_at` が設定済みのイベント（Stripeの再送）は即座に200を返してスキップします |
| 失敗したイベントの取りこぼし防止 | 処理途中で失敗すると `processed_at` を記録しないため、Stripeの再送で必ず処理し直されます。失敗のたびに `attempts` が増えるので、再送を繰り返すイベントを後から把握できます |
| 遅延イベントの遮断 | `profiles.stripe_event_created_at` と比較し、古いイベントは破棄 |
| 削除済みユーザー | FK違反（`auth.users`）なら 500 を返さず 200 を返して再送ループを防ぐ |

### cron の処理量

| 対象 | 上限 |
|---|---|
| ユーザー | `USERS_PER_RUN`（既定20）を時刻ベースで回転させ、毎回違うユーザーを処理する |
| 自動返信 | `AUTO_REPLY_BATCH_SIZE`（既定20件）。残りは次回に回す |

どちらも `src/lib/google/sync-batch.ts` に集約しています。上限を置かないと、
店舗数やレビュー数に応じて Worker の実行上限に達して途中で止まるためです。

### RLS ポリシー一覧

全テーブルで `enable row level security` が有効です。

| テーブル | ポリシー | コマンド | 条件 |
|---|---|---|---|
| `profiles` | `profiles_select_own` | SELECT | `auth.uid() = id` |
| `shop_settings` | `shop_settings_select_own` | SELECT | `auth.uid() = id` |
| `shop_settings` | `shop_settings_insert_own` | INSERT | `auth.uid() = id` |
| `shop_settings` | `shop_settings_update_own` | UPDATE | `auth.uid() = id` |
| `reviews` | `reviews_select_own` | SELECT | `auth.uid() = user_id` |
| `gbp_connections` | `gbp_connections_select_own` | SELECT | `auth.uid() = user_id`。**列単位のGRANTでトークン列は対象外**（`20261020120600`） |
| `gbp_connections` | `gbp_connections_delete_own` | DELETE | `auth.uid() = user_id` |

> `reviews` と `gbp_connections` には insert/update ポリシーがありません。
> 書き込みは service role クライアントがRLSを迂回して行います。

### マイグレーションの適用

Supabase の **SQL Editor** で `supabase/migrations/` のファイルを**順番に**実行してください。
1ファイル目で `set_updated_at()` 関数が作られます。

1. `20261019120000_create_profiles.sql`
2. `20261020120000_create_shop_settings.sql`
3. `20261020120100_create_reviews.sql`
4. `20261020120200_create_gbp_connections.sql`
5. `20261020120300_add_category_and_auto_reply.sql`（`category` / `auto_reply_enabled` / `auto_replied`）
6. `20261020120400_add_claim_and_preserve_reply.sql`（`claimed_at` / 返信履歴保持トリガー）
7. `20261020120500_add_connection_status.sql`（`gbp_connections.status`）
8. `20261020120600_limit_gbp_connections_grant.sql`（`gbp_connections` のトークン列を列単位のGRANTに）
9. `20261020120700_create_stripe_events.sql`（`stripe_events` テーブル / `profiles.stripe_event_created_at`）
10. `20261020120800_add_reply_source.sql`（`reviews.posted_via`）
11. `20261021100000_add_stripe_event_processing.sql`（`stripe_events.processed_at` / `stripe_events.attempts`）
12. `20261021110000_add_auto_reply_attempts.sql`（`reviews.auto_reply_attempts`）
13. `20261021120000_add_claimed_by.sql`（`reviews.claimed_by`）
14. `20261021130000_revoke_anon_gbp_connections.sql`（`gbp_connections` の `anon` ロールの select 権限を revoke）

> **適用順は「マイグレーション → コード」の順**です。
> 11〜14のマイグレーションを適用してから、そのマイグレーションを前提とするコードを
> デプロイしてください。逆順（コードを先にデプロイしてマイグレーションを後で適用する）と、
> 排他制御や試行回数の列がDBに存在しない状態で動作します。
>
> 特に `20261021120000_add_claimed_by.sql` が未適用の環境では `claimed_at` のみで排他が
> 働きます（処理は続行し、ログに警告が出ます）。排他は失われませんが、所有者の概念が
> 失われるため、**二重投稿のリスクがあります**。

`supabase/setup-all.sql` は全マイグレーションをまとめた**冪等**なスクリプトです。
几次実行しても失敗しません（`create table if not exists` / `drop policy if exists` / トランザクションで囲み +
末尾の確認クエリ付き）。

> **`supabase/setup-all.sql` は手で編集しないでください。**
> `supabase/migrations/` のファイルをファイル名順に連結したもので、次で再生成します。
>
> ```bash
> npm run setup:sql          # 再生成
> npm run setup:sql:check    # 差分チェック（一致していなければ非ゼロ終了）
> ```

---

## 4. API リファレンス

### ルートハンドラ

#### `GET /api/google/oauth/start`

Google OAuth2の認可URLへリダイレクトします。

- **認可**: ログインユーザーのみ。未ログインは `/login` へ
- **リダイレクト先**: Googleの同意画面
- **CSP対策**: `state` をランダム生成し、`google_oauth_state` Cookie（httpOnly / sameSite=lax / 10分）へ保存
- **エラー**: `GOOGLE_CLIENT_ID` 未設定なら `/settings?google=not_configured`

#### `GET /api/google/oauth/callback`

OAuth2のコールバック。

- **認可**: ログインユーザーのみ。`state` が Cookie の値と一致しない場合は `400`
- **処理**: コードをトークンに交換 → リフレッシュトークンが無い場合は `/settings?google=need_reconsent` → アカウント一覧 → 配下の全ロケーションを `gbp_connections` に保存
- **リダイレクト先**: `/settings?google=connected` / `no_location` / `error`

#### `POST /api/reviews/sync`

レビュー取得と自動返信のバッチ処理。cronの実行対象です。

- **認可**: `Authorization: Bearer ${CRON_SECRET}` が一致しない場合は `401`
- **処理**: service role クライアントで `gbp_connections` から全ユーザーを列挙し、
  `selectUsersForRun()` で1回の処理対象を上限分だけ回転選択して、
  各ユーザーについて `syncReviews` と `autoReplyPendingReviews` を実行
- **レスポンス**: `{ ok, totalUsers, processedUsers, imported, replied }`
- **メソッド**: 状態を変更するため `POST` のみ（`GET` は受け付けない）

#### `POST /api/stripe/webhook`

Stripeからのイベント受信。

- **認可**: `stripe-signature` ヘッダーを `stripe.webhooks.constructEvent` で検証
- **対応イベント**:
  - `checkout.session.completed` → `profiles` に `stripe_customer_id` / `email` を保存
  - `customer.subscription.created` / `updated` / `deleted` → `subscription_status` を `none` / `active` / `past_due` / `canceled` にマップして更新

#### `GET /auth/confirm`

メール確認リンクの処理。

- `token_hash` + `type` がある場合は `supabase.auth.verifyOtp`、なければ `code` で `exchangeCodeForSession`
- 成功 → `/dashboard`、失敗 → `/error?reason=confirm`

### Server Actions

| ファイル | アクション | 概要 |
|---|---|---|
| `src/app/(app)/settings/actions.ts` | `saveShopSettings` | `shop_settings` の upsert（ユーザー権限） |
| | `syncReviewsAction` | レビュー取得 + 自動返信 |
| | `disconnectGoogleAction` | `gbp_connections` の削除 |
| `src/app/(app)/reviews/actions.ts` | `generateAndPostReply` | 1件のレビューについてAI返信生成 → GBPへ投稿 |
| `src/app/(app)/billing/actions.ts` | `createCheckoutSession` | Stripe Checkout Session の作成とリダイレクト |
| | `createPortalSession` | Stripe Billing Portal へのリダイレクト |

### Google Business Profile API クライアント

`src/lib/google/business.ts` がGBP APIの呼び出しをまとめています。

| 関数 | 用途 |
|---|---|
| `listAccounts` | 管理できるアカウント一覧を取得 |
| `listLocations` | アカウント配下の店舗一覧を取得（`nextPageToken` を回して全件） |
| `listReviews` | 店舗のレビューを取得。`orderBy=updateTime desc` で全ページを回し、1店舗あたり200件で打ち切り |
| `getReviewReply` | 1件のレビューに既付いている返信を取得（投稿前の重複チェックに使う） |
| `replyToReview` | 返信を投稿（`PUT /{review}/reply`） |

失敗はすべて `src/lib/google/api-error.ts` の `GoogleApiError` として投じます。

```ts
// src/lib/google/api-error.ts
export class GoogleApiError extends Error {
  readonly status: number; // HTTPステータスコード
}

export function isRetryableStatus(status: number): boolean;
// 429（クォータ超過）と5xx（サーバーエラー）だけ true
```

> 呼び出し側は `error.status` で「再試行すべき429・5xx」「再認証が必要な401」を
> 判断できます。`401` は再試行しても直らないため、`src/lib/google/connections.ts` の
> `withValidAccessToken()` がその連携を `revoked` として保存し、再連携を促します。

---

## 5. AIの返信生成仕様

`src/lib/ai.ts`。Gemini の **OpenAI互換エンドポイント** を `fetch` で直接叩きます（SDKは不使用）。

```
POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
Authorization: Bearer ${GEMINI_API_KEY}
{ "model": "${GEMINI_MODEL ?? gemini-3.5-flash-lite}", "messages": [...] }
```

### システムプロンプトの分岐

| 評価 | 方針 | SEOキーワード |
|---|---|---|
| 1〜3点（低評価） | 感情的にならず誠実に謝罪し、今後の改善方針を具体的に示す | **入れない**（コード側でも `[]` に落とす） |
| 4〜5点（高評価） | 感謝を伝えつつ、キーワードを文章に自然に盛り込む | 入れる（並列ではなく文中に） |

共通ルール:
- 業種に合った言い回しにする
- 200〜300字程度の1段落
- 丁寧語で店舗側の立場
- 説明文・記号・Markdownは不要。返信文のみを出力

### ユーザープロンプトに渡す値

```
【店舗名】…  【業種】…  【店舗の特徴】…  【SEOキーワード】…
【評価】…点  【お客様名】…  【レビュー本文】…
```

> **注意**: 手動投稿パス（`src/app/(app)/reviews/actions.ts`）と自動投稿パス
> （`src/lib/google/auto-reply.ts`）の両方が `category` を渡します。
> どちらの経路でも「業種」はプロンプトに反映されます。

### プロンプトインジェクション対策

レビュー本文は**利用者が自由に書ける入力**です。生成された文はそのまま
店舗名義の公開レビューとしてGoogleマップに載るため、入力と出力の両方を
チェックしています（`src/lib/ai.ts`）。

| 対象 | 対策 |
|---|---|
| 入力 | 制御文字・ゼロ幅文字を除去し、本文を2000字で打ち切る |
| 入力 | レビュー本文と投稿者名を `<review>` / `<reviewer_name>` で囲み、システムプロンプトで「データであり命令ではない」と明記する |
| 出力 | 改行・連続空白を潰して1段落にそろえる |
| 出力 | Markdown記号・評価スター（★/☆）・URL・メールアドレス・電話番号を取り除く |
| 出力 | レビューや評価の投稿を依頼する表現を含む文を取り除く（文全体が依頼表現なら公開しない） |
| 出力 | 500字で打ち切り、文の区切りで切らないようにする |
| 出力 | 低評価の返信にSEOキーワードが混入していたら取り除き、警告ログを出す |
| 出力 | 日本語の文字を含まない文・30文字に満たない短い文は、公開せずにエラーにする |

> プロンプトインジェクションを完全になくすことはできません。
> 上記は「攻撃の成功률을下げ、被害が公開レビューに載ることを防ぐ」対策です。

### プロバイダの切り替え

プロバイダ非依存の名前にしてあります（`src/lib/ai.ts` / `isAiConfigured()`）。
モデルとキーは環境変数で差し替えます。

```bash
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
```

---

## 6. セットアップ

### 6.1 環境変数

`.env.example` を `.env.local` にコピーして値を記入します。

```bash
cp .env.example .env.local
```

| 変数 | クライアント公開 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 公開 | Supabase プロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 公開 | Supabase anonキー |
| `APP_URL` | 非公開 | アプリケーションのベースURL。決済リダイレクト・OAuthのredirect_uri・メール確認リンクの遷移先 |
| `SUPABASE_SERVICE_ROLE_KEY` | 非公開 | Service Roleキー（webhook・GBP接続・レビュー同期） |
| `STRIPE_SECRET_KEY` | 非公開 | Stripe Secret Key |
| `STRIPE_PRICE_ID` | 非公開 | 月額プランの Price ID |
| `STRIPE_WEBHOOK_SECRET` | 非公開 | Webhook署名検証用シークレット |
| `GOOGLE_CLIENT_ID` | 非公開 | OAuth クライアントID |
| `GOOGLE_CLIENT_SECRET` | 非公開 | OAuth クライアントシークレット |
| `GOOGLE_REDIRECT_URI` | 非公開 | 承認済みリダイレクトURI |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 非公開 | トークン暗号化キー（32バイトhex） |
| `GEMINI_API_KEY` | 非公開 | Gemini APIキー |
| `GEMINI_MODEL` | 非公開 | モデル名（既定 `gemini-3.5-flash-lite`） |
| `CRON_SECRET` | 非公開 | `/api/reviews/sync` のBearerトークン |

> **秘密の置き場所**
> `.env.local` と `.dev.vars` はgitignore対象です。ルートの `.env` は
> `WRANGLER_BUILD_*` 用のため追跡対象になっています。**ここに秘密情報は書かないでください**。
> なお、gitignore対象でもCloudflare向けのビルドでは env ファイルの内容が
> Workerバンドルへ焼き込まれます（[7.8 ビルド時の秘密情報対策](#78-ビルド時の秘密情報対策)）。

### 6.2 Supabase（メール確認）

Supabase プロジェクトを作成し、**Project Settings → API** からURLとanonキーを取得します。

- **開発時のみ**: Authentication → Sign In / Providers → Email の **Confirm email を OFF** にすると確認メールなしでログインできます
- **本番では Confirm email を ON** のままにしてください（未確認アカウントの攻撃リスク）

Confirm email を ON で使う場合、Authentication → Email Templates → Confirm signup のURLを変更します。

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

（デフォルトの `{{ .ConfirmationURL }}` のままでも `/auth/confirm?code=` 経由で動作します）

> Supabaseは `example.com` などの予約ドメインを新規登録に拒否します。テスト時は実在するドメインのメールアドレスを使ってください。

### 6.2.1 Supabase（Googleでサインイン）

ログイン画面の **「Googleで始める」** を使う場合は、Supabase 側で Google provider を有効にします。

1. Authentication → Sign In / Providers → **Google** を有効化
2. Google Cloud Console で **別のOAuthクライアント** を作成します
   - 承認済みリダイレクトURI: `https://<project-ref>.supabase.co/auth/v1/callback`
   - GBP連携用（`GOOGLE_CLIENT_ID`）とは**別**のクライアントにしてください。GBP用は同意画面が `business.manage` スコープで設定されており、Supabase用のcallbackを扱えません
3. 作成したクライアントID/Secretを Authentication → Providers → Google に設定
4. Authentication → URL Configuration → **Redirect URLs** に次を追加
   - `http://localhost:3000/auth/confirm`（開発）
   - `https://<your-domain>/auth/confirm`（本番）

> Googleの同意画面が「テスト」モードの場合、Supabase経由のGoogleサインインも
> テストユーザー限定になります。一般公開にはGoogleへの公開申請が必要です
> （GBPのアクセス承認とは別の申請です）。

### 6.3 データベース

[3. データモデル](#マイグレーションの適用) を参照してください。

### 6.4 Stripe（月額課金）

1. Products で**月額プラン**を作成し、Price ID（`price_...`）を取得
2. Developers → API keys の Secret Key（`sk_test_...` / 本番は `sk_live_...`）を取得
3. Developers → Webhooks でエンドポイントを作成
   - URL: `https://<your-domain>/api/stripe/webhook`
   - イベント: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Signing secret（`whsec_...`）を取得
4. `.env.local` に `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` を設定

ローカル開発時はStripe CLIで転送します。

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# 出力された whsec_... を .env.local の STRIPE_WEBHOOK_SECRET に設定
```

> 環境変数が未設定の間はダッシュボードに「決済設定がまだ完了していないため、契約できません」と表示され、契約ボタンは出ません。

### 6.5 Googleマップ連携

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

> **注意**: Business Profile API を一般の店舗ユーザーに提供するには、Googleによるアクセス承認（審査）が必要です。
> 審査前のPJでは自分のアカウントの店舗のみ認識されます。実店舗への提供開始は審査完了が前提です。

### 6.6 Gemini

1. [Google AI Studio](https://aistudio.google.com/apikey) でAPIキーを作成
2. `.env.local` に `GEMINI_API_KEY` を設定（モデル変更は `GEMINI_MODEL`、既定は `gemini-3.5-flash-lite`）

> OpenAI互換エンドポイントを直接叩いているため、OpenAI SDKは不要です。

### 6.7 起動

```bash
npm install --include=dev
npm run dev
```

http://localhost:3000 を開く

> **開発時の注意**: Next.js 16 は開発サーバーへの別オリジンからのアクセスを遮断します。
> `http://127.0.0.1:3000` やLANのIPでアクセスする場合は、`next.config.ts` の
> `allowedDevOrigins` にそのホストを追加してください（`127.0.0.1` は設定済み）。
> この設定が無いとHMR接続が遮断され、**Reactがハイドレーションされずボタンなどが一切反応しません**（本番ビルドでは起こりません）。

> **メモリ不足でビルドが失敗する場合**: `Zone Allocation failed - process out of memory` が出る場合は、
> ブラウザを閉じて空きメモリを増やしたうえでheapを拡張して実行してください。
>
> ```bash
> set NODE_OPTIONS=--max-old-space-size=6144 && npm run build   # Windows (cmd)
> NODE_OPTIONS=--max-old-space-size=6144 npm run build         # macOS / Linux
> ```

---

## 7. デプロイ（Cloudflare Workers）

Cloudflare Pages の旧来のNext.js対応（`@cloudflare/next-on-pages`）は非推奨のため、
**Cloudflare Workers + OpenNext** でデプロイします。

### 7.1 前提

- Cloudflare アカウント（Workers **Paid** プラン推奨。FreeプランはWorkerサイズ3MB・CPU時間10ms制限で本アプリには不足します）
- `npm install --include=dev`（`NODE_ENV=production` が設定されている環境では devDependencies が入れられないため）

### 7.2 ローカルで動作確認（workerd）

```bash
npm run preview     # ビルドして Workers ランタイムでローカル起動（http://127.0.0.1:8787）
```

`.dev.vars`（gitignore対象）にローカル用の環境変数を置いてください。`NEXTJS_ENV=development` を含めると `.env.local` が読み込まれます。

### 7.3 Cloudflare へログイン

```bash
npx wrangler login
```

### 7.4 Secret（環境変数）を登録

`NEXT_PUBLIC_*` はビルド時にインライン化されるため、**ビルド時に `.env.local` が必要**です。
サーバー実行時に必要な値は Secret として登録します。

```bash
npx wrangler secret put APP_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_PRICE_ID
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
npx wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CRON_SECRET
```

### 7.5 デプロイ

`npm run build` は Next.js のアプリ用ビルド（`.next` を作るだけ）で、
`npm run deploy` は Cloudflare Workers 向けのビルドです。

```bash
npm run deploy      # opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

デプロイ後は `https://<worker名>.<subdomain>.workers.dev` でアクセスできます。
独自ドメインは Cloudflare ダッシュボードの Workers → Settings → Domains で設定します。

### 7.6 自動取得（cron）

`wrangler.jsonc` の `triggers.crons` で **1時間ごとに** `/api/reviews/sync` が実行されます。
`worker.ts` の scheduled handler が `CRON_SECRET` 付きで内部呼び出しします
（Cloudflareのcronは認証ヘッダーを付けられないため）。
`CRON_SECRET` が未設定だとログにエラーが出て実行されません。

ローカルでcronを手動発火する場合:

```bash
curl http://127.0.0.1:8787/cdn-cgi/local/scheduled
```

### 7.7 Cloudflare固有の制約（重要）

| 制約 | 対応 |
|---|---|
| **Cache Components（`cacheComponents`）は使用不可** | workerdの `setTimeout()` 実装と非互換でページ描画がハングします。`await connection()` / `export const instant` は使わず、各ページに `export const dynamic = "force-dynamic"` を指定します |
| **Node.js middleware（`proxy.ts`）はexperimental** | 公式は「動作保証なし」。動作は確認済みですが、Cloudflareの更新で変わる可能性があります |
| Workerサイズ上限 | Free 3MB / Paid 10MB（gzip後）。`stripe` と `supabase-js` が大きいためPaid推奨 |
| R2 / D1 / Durable Objects は**不要** | 全ルートが動的（SSR）のため、キャッシュ設定なしで動作します |
| Windowsでのビルドは非推奨 | 公式は WSL または CI（GitHub Actions）でのビルドを推奨。`npm run deploy` は Windows でも動作します |

### 7.8 ビルド時の秘密情報対策

OpenNext のビルド（`opennextjs-cloudflare build`）は、プロジェクト直下の env ファイルを
読み取り、その中身を**平文で** Worker バンドル（`.open-next/cloudflare/next-env.mjs`）へ
書き込みます。`.env.local` が `.gitignore` 済みでも、**デプロイ物には入ります**。
ソースには無いはずの service_role キーやトークン暗号鍵が、そのまま公開される恐れがあります。

そこで `scripts/build-cloudflare.ts` を使ってビルドしてください。

```bash
npm run build:cf
```

手順は次の4つです。

1. **退避** — 秘密情報を含む env ファイルを退避し、公開情報だけの内容に差し替える
   （元の内容は同じディレクトリの `.build-backup` に残す）
2. **ビルド** — `opennextjs-cloudflare build` を実行する
3. **検査** — 生成された `.open-next/cloudflare/next-env.mjs` に秘密情報が混ざっていないか確認する
4. **復元** — ビルドの成否にかかわらず元の env ファイルを戻す

**検査で秘密情報が検出された場合は、終了コードが非ゼロになります。**
そのまま `opennextjs-cloudflare deploy` を実行しないでください。

> `npm run build:cf` で秘密情報を退避したうえで Cloudflare向けのビルドを実行できます。
> `npm run deploy` / `npm run preview` / `npm run upload` は
> いずれも `build:cf` を通るため、直接 `opennextjs-cloudflare build` を
> 実行しないでください。

---

## 8. 検証手順

手動で一通り確認する手順です。

1. 未ログインで `/dashboard` `/settings` `/reviews` → `/login` へリダイレクトされること
2. `/signup` で新規登録 → 確認メール → ログイン → `/dashboard` が表示されること
3. ログアウト → `/dashboard` へ直接アクセスすると `/login` へ戻ること
4. `npm run lint` と `npm run build` がエラーなく通ること
5. ダッシュボードに「月額プラン」カードが表示され、ステータスが「未契約」バッジで見えること
6. （Stripe設定後）「月額プランを契約する」→ Checkout画面 → テストカード決済 → `/dashboard?checkout=success` へ戻り、webhook反映後に「契約中」バッジへ変わること
7. `/settings` で店舗名・業種・強み・SEOキーワードを保存し、再読み込み後も保持されること
8. `/settings` の「自動返信をONにする」をONにして保存 → ダッシュボードの「自動返信 ON」バッジが変わること
9. `/reviews` が表示され、レビューが0件のときは空状態案内になること
10. （Google設定後）`/settings` の「Googleマップと連携する」→ Googleの同意画面 → 戻ると店舗が「連携済み」になること
11. 「レビューを取得する」でレビューが取得され、`/reviews` に表示されること
12. 未返信のレビューで「AI返信を作成して投稿」→ Googleマップに返信が掲載され、レビュー一覧に「返信済み」と表示されること
13. 自動返信がONの状態でレビューを取得すると、自動で返信が生成・投稿され「AIが自動で作成した返信」と表示されること
14. 低評価（1〜3点）の返信にSEOキーワードが入っていないこと、高評価（4〜5点）には入っていること
15. 「業種」を設定した状態で返信を生成すると、業種に合った言い回しになること
16. 返信済みのレビューで「AI返信を作成して投稿」を押すと「既に返信しています」と表示され、二重投稿されないこと
17. 未契約の状態で `/reviews` `/settings` に「月額プランが未契約です」の案内が出ること。未返信レビューの返信ボタンが「AI返信を作成（下書き）」になり、Googleマップへは投稿されないこと
18. 契約後に `/reviews` に「AI返信を作成して投稿」ボタンが現れること
19. 1店舗のレビューが50件を超えていても、200件まで取得されること
20. Googleマップ上で店主が返信済みのレビューに、自動返信が二重に投稿されないこと

### 検証スクリプト

| スクリプト | 内容 |
|---|---|
| `npx tsx scripts/verify-paywall.ts` | 契約状態ごとのゲーティング（未契約/契約中/猶予/解約済み）とStripeの状態マッピング |
| `npx tsx scripts/verify-reply-idempotency.ts` | 再取得で返信履歴が失われず、二重投稿が起きないこと |
| `npx tsx scripts/verify-signup-trigger.ts` | 新規登録時に `profiles` 行が自動作成されること（`handle_new_user` トリガー） |
| `npx tsx scripts/verify-resilience.ts` | 連携単位のエラー分離・失効トークンの検出・プロンプトインジェクション対策・SEOキーワード検証・ページング・cronの回転 |

> **⚠ これらのスクリプトは本番DB（Supabase）を書き換えます。**
> 検証用の行（`auth.users` / `reviews` / `gbp_connections`）を作り、`profiles` 行の
> `subscription_status` を一時的に書き換えます。実行するには環境変数 **`ALLOW_LIVE_DB=1`** が必要です。
> 未設定のまま実行すると、**データに触れずに**（DBへ接続もせず）非ゼロ終了します。
> 終了時には `profiles` 行を元どおり復元します（元の行が無ければ、テストで作った行を削除）。
>
> ```powershell
> # PowerShell
> $env:ALLOW_LIVE_DB="1"; npx tsx scripts/verify-paywall.ts
> ```
>
> ```bash
> # bash / zsh
> ALLOW_LIVE_DB=1 npx tsx scripts/verify-paywall.ts
> ```
>
> 実行前に、対象DBのURLと書き込み的内容が表示されます。表示される内容を確認してから実行してください。

> **注意**: `claimed_at` を使う排他制御（C5）を効かせるには、
> `20261020120400_add_claim_and_preserve_reply.sql` の適用が必要です。
> `claimed_by` を使う排他制御（確保した所有者を記録する）を効かせるには、
> `20261021120000_add_claimed_by.sql` の適用も必要です。
> 未適用の場合も自動返信は動作しますが、排他制御は効きません（ログに警告が出ます）。

---

## 9. ディレクトリ構成

```
src/
├── proxy.ts                 # セッション更新とルート保護（Next.js 16のmiddleware後継）
├── lib/
│   ├── ai.ts                 # AI返信文の生成（Gemini / OpenAI互換エンドポイント）
│   ├── app-url.ts            # アプリケーションのベースURL（APP_URL）
│   ├── auth.ts               # 認証済みユーザーの取得（React.cache でメモ化）
│   ├── billing.ts            # 契約状態の判定（課金のゲート）
│   ├── crypto.ts             # Googleトークンの暗号化（AES-256-GCM）
│   ├── review-claims.ts      # 自動返信の排他制御（claimed_at / claimed_by の確保・解放）
│   ├── seo-keywords.ts       # SEOキーワードの往復と検証
│   ├── shop-categories.ts    # 業種の選択肢とGoogleマップの業種名への対応表
│   ├── shop-settings.ts      # Googleマップの店舗情報から店舗設定の初期値を投入
│   ├── stripe.ts             # Stripeクライアント・価格ラベル取得
│   ├── google/
│   │   ├── api-error.ts      # Google API のエラー表現（GoogleApiError / isRetryableStatus）
│   │   ├── oauth.ts          # OAuth2.0（認証URL・コード交換・トークン更新）
│   │   ├── business.ts       # Business Profile API（店舗・レビュー取得・返信）
│   │   ├── connections.ts    # 連携情報の保存とアクセストークン管理
│   │   ├── reviews.ts        # レビュー取得・DB同期・返信の記録
│   │   ├── auto-reply.ts     # 未返信レビューの自動生成・自動投稿
│   │   └── sync-batch.ts     # 1回の処理量の上限と回転選択
│   ├── supabase/
│   │   ├── client.ts         # ブラウザ用クライアント
│   │   ├── server.ts         # サーバー用クライアント
│   │   └── admin.ts          # Service Roleクライアント（webhook・Google連携用）
│   └── utils.ts              # cn ヘルパー
├── components/
│   ├── ui/                   # shadcn/uiコンポーネント（Base UIベース）
│   ├── auth/                 # ログイン・新規登録フォーム
│   ├── billing/plan-card.tsx # 月額プランカード（ステータス・契約/管理ボタン）
│   ├── billing/subscription-notice.tsx # 未契約時の案内バナー
│   ├── landing/              # ランディングページ用（ヘッダー・レビュー実例・FAQ）
│   ├── reviews/              # レビュー履歴リスト・AI返信ボタン
│   ├── settings/             # 店舗設定フォーム・Google連携カード
│   └── app-header.tsx        # 認証後ヘッダー（ナビゲーション）
└── app/
    ├── page.tsx              # ランディングページ
    ├── layout.tsx            # ルートレイアウト（テーマ・Toaster）
    ├── globals.css           # テーマトークン
    ├── (auth)/               # ログイン・新規登録
    ├── (app)/dashboard/      # 保護ページ（プランカード・店舗設定・最新レビュー）
    ├── (app)/settings/       # 店舗設定ページ + Server Actions
    ├── (app)/reviews/        # レビュー履歴ページ + Server Actions
    ├── (app)/billing/        # Checkout/Portal Server Actions
    ├── api/stripe/webhook/   # Stripe webhook（署名検証・ステータス更新）
    ├── api/google/oauth/     # Google OAuth 開始・コールバック
    ├── api/reviews/sync/     # レビュー一括取得（CRON_SECRETで認可）
    ├── auth/confirm/         # メール確認リンク処理
    └── error/                # 認証エラーページ
docs/manual.md                # 店舗利用者向けの操作マニュアル
scripts/                     # 検証スクリプト（ライブDBに対して実行する）
│   ├── build-cloudflare.ts  # Cloudflare向けのビルド（秘密情報を退避して検査する）
│   ├── generate-setup-all.ts # supabase/setup-all.sql の再生成（--check で差分検出）
│   └── lib/live-guard.ts    # 検証スクリプトの保護（ALLOW_LIVE_DB チェック・復元）
supabase/migrations/          # DBマイグレーションSQL
supabase/setup-all.sql        # 全マイグレーションの冪等な統合スクリプト
open-next.config.ts           # OpenNext（Cloudflare Workers）設定
wrangler.jsonc                # Workers設定（assets・cron・compatibility flags）
worker.ts                     # Workersカスタムラッパー（cronのscheduled handler）
next.config.ts                # Next.js設定（セキュリティヘッダー・許可オリジン）
.github/workflows/ci.yml     # CI（lint / typecheck / build）
```

---

## 10. 運用メモ

- **レビュー取得**: `/settings` の「レビューを取得する」で手動取得できます。自動取得はCloudflareのcron（`wrangler.jsonc` の `triggers.crons`）が1時間ごとに `/api/reviews/sync` を実行します。1店舗につき最新200件まで取得します。Googleマップの連携があれば**未契約でも取得できます**（未契約は1店舗まで。契約するとすべての店舗が対象です）。
- **課金のゲート**: 判定は `src/lib/billing.ts` の `getAccessLevel()` に集約しています。Googleマップの連携があれば、レビュー取得・閲覧とAI返信の**下書き作成**までは未契約でも利用できます（未契約は1店舗まで）。Googleマップへの**投稿**と**自動返信**は契約中のみ利用できます。未契約時は `/reviews` と `/settings` に案内バナーを表示し、cronでは投稿・自動返信を静かにスキップします。
- **自動返信**: `shop_settings.auto_reply_enabled` が true の店舗だけ、取得したレビューへ自動で返信を投稿します（初期値はOFF）。手動で投稿したものは「AIが作成した返信」、自動のものは「AIが自動で作成した返信」と表示されます。処理対象の行は `claimed_at` と `claimed_by` で排他的に確保するため、cron と手動操作が同時に走っても同じレビューへ二重投稿されません。
- **自動返信の除外**: 同じレビューで投稿が繰り返し失敗すると、そのレビューの `auto_reply_attempts` が増えて上限（5回）に達し、**自動返信の対象から自動的に外れます**（他のレビューに処理枠を回すため）。Googleマップ上に既存の返信が見つかったときや、返信の記録に成功したときは 0 に戻ります。
- **投稿前の重複チェック**: 手動投稿・自動返信のどちらも、投稿の直前にGoogleマップ上の返信を読みます。既に返信がある場合は上書きせず、投稿を中止します。自動返信では、その返信をアプリ側に取り込みます。
- **返信の保持**: 一度投稿した返信は、再取得のたびに消えることはありません。GBPの応答に `reviewReply` が含まれない場合も保存済みの返信履歴は保持されます。
- **AI返信の投稿**: 低評価（1〜3点）は「謝罪・改善案のみ、SEOキーワードは入れない」、高評価（4〜5点）は「感謝 + SEOキーワードを自然に盛り込み」。生成した文はそのままGoogleマップへ投稿されます。日本語でない・短すぎる・レビューや評価の投稿依頼を含む文は、投稿せずにエラーにします。
- **トークン管理**: Googleのアクセストークン・リフレッシュトークンは `GOOGLE_TOKEN_ENCRYPTION_KEY` で暗号化して保存しています。キーが変わると再連携が必要です。**本番と開発では別のキーを使ってください。**
- **トークンの更新**: `getValidAccessToken()` が暗号化されたアクセストークンを復号し、期限（現在時刻+60秒より前）が切れている場合はリフレッシュトークンで更新・再暗号化します。更新が `invalid_grant` で失敗した場合は、その連携を `revoked` として保存し、以後の処理対象から外します。トークンが有効でもGBP APIが `401` を返す場合も同じ扱いになり、毎時の取得対象から外れます（`/settings` に「再連携が必要」と表示されます）。
- **Stripe webhook の記録**: イベントは**処理に成功したあと**に `stripe_events.processed_at` を書いて「処理済み」とします。処理に失敗した場合は記録しないため、Stripeの再送で必ず処理し直されます。失敗のたびに `attempts` が増えるので、再送を繰り返すイベントを後から把握できます。
- **ベースURL**: 決済リダイレクト・OAuthのredirect_uri・メール確認リンクの遷移先は `APP_URL` の環境変数で固定しています。リクエストのHostヘッダーから求めると改ざんされるためです。
- **暗号化方式**: AES-256-GCM。形式は `base64(iv).base64(authTag).base64(ciphertext)`。鍵は `GOOGLE_TOKEN_ENCRYPTION_KEY`（64文字のhex = 32バイト）。

---

## 11. 既知の制約

外部サービスの設定など、未検証の項目は [`todolist.md`](todolist.md) を参照してください。コードから読み取れる制約は以下のとおりです。

| 制約 | 影響 |
|---|---|
| レビューの取得件数は最新200件 | 200件を超えると古いレビューは自動取得の対象外 |
| レビュー一覧のページングなし | 全件を一度に読み込みます |
| `reviews` と `gbp_connections` に insert/update のRLSポリシーがない | service role 経由の一括書き込みのみ。ユーザー操作で直接書き込めない設計です |
| 契約状態の読み取りは `profiles` 行に依存する | `profiles` 行が無いユーザー（トリガー適用前の既存ユーザー）は未契約として扱われます。契約時にStripeのwebhookが行を作るため実害はありません |
| 自動返信の1回あたり上限は20件 | `AUTO_REPLY_BATCH_SIZE`。残りは次回の実行に回ります。上限自体は変えられます |
| 自動返信の試行回数の上限は5回 | `auto_reply_attempts` が5に達したレビューは自動返信の対象から外れます。手動で再試行させるにはSQLで `auto_reply_attempts = 0` に戻します |
| 未適用マイグレーションの影響 | `claimed_at` は排他制御、`claimed_by` は排他制御の所有者、`status` は失効連携の保存、`posted_via` は返信の出所表示、`auto_reply_attempts` は繰り返し失敗するレビューの除外、`stripe_events.processed_at` はwebhookの重複遮断に必要です。いずれも fail-soft で動きますが、`posted_via` は返信が「AIが作成した返信」と表示されません |
| `Content-Security-Policy` は未設定 | `next.config.ts` で意図的に入れていません。段階導入のメモは [12. セキュリティと CI](#12-セキュリティと-ci) を参照してください |
| エラーバウンダリは1ルートのみ | `(app)` 配下と `global-error` / `not-found` は用意していますが、(auth) ページとAPIルートにはありません |
| ルート直下の `.env` が追跡対象 | `WRANGLER_BUILD_*` を保持するため。秘密情報は `.env.local` / `.dev.vars` / `wrangler secret put` で管理してください |
| `APP_URL` は必須 | 未設定だと決済のCheckout作成とOAuthの開始が失敗します（`/dashboard?checkout=error` に遷移）。メール確認リンクはリクエストのoriginにフォールバックします。本番では必ず `wrangler secret put APP_URL` を実行してください |
| (auth) ページとAPIルートにエラーバウンダリがない | 404は `not-found.tsx` を使うが、`/login` `/signup` の例外は素のエラーページになります |
| 自動テストが無い | CIは lint / typecheck / build のみです。変更後は [8. 検証手順](#8-検証手順) による手動確認と、検証スクリプトによる実DBでの確認が必要です |

---

## 12. セキュリティと CI

### 12.1 セキュリティヘッダー

`next.config.ts` の `headers()` で、アプリ全体（`/:path*`）に次のヘッダーを付与しています。

| ヘッダー | 値 | 目的 |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | レスポンスの Content-Type を推測させない |
| `X-Frame-Options` | `DENY` | iframe への埋め込みを禁止する（クリックジャッキング対策） |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 別オリジンへ遷移するとき、Referer にURL全体を送らない |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | https を2年間強制する（本番は https で配信されます） |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | カメラ・マイク・位置情報の利用を禁止する |

`Content-Security-Policy` は**意図的に設定していません**。
このアプリは Next.js の Script とインラインスクリプトを使うため、素のCSPを入れると
ページが白画面になることがあります。

段階導入する場合は、まず緩い設定で配信し、実害がないことを確認してから
`'unsafe-inline'` / `'unsafe-eval'` を外す運用にしてください。
`connect-src` には Supabase のAPI呼び出し先（`https://*.supabase.co`）を
含める必要があります。ここを絞るとログインやレビュー取得が失敗します。

```ts
// next.config.ts（段階導入時の例）
{
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; "),
}
```

### 12.2 CI（GitHub Actions）

`.github/workflows/ci.yml` で、push（`main` ブランチ）とpull requestのたびに
次の3つを自動実行します。

| ジョブ | 実行するコマンド |
|---|---|
| `lint` | `npm run lint` |
| `typecheck` | `npx tsc --noEmit` |
| `build` | `npm run build` |

CIには外部サービスの資格情報（`STRIPE_SECRET_KEY` / `GEMINI_API_KEY` など）を
**設定しません**。未設定でも `next build` が通る設計にしてあるためです。

> `npm run build` はCloudflare向けのビルドではありません（[7.5 デプロイ](#75-デプロイ) を参照）。
> 本番向けのWorkerバンドルを作る場合は、秘密情報の検査が挟まれた
> `scripts/build-cloudflare.ts` を使ってください（[7.8 ビルド時の秘密情報対策](#78-ビルド時の秘密情報対策)）。
