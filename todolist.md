# 残タスク一覧（レビュー返信AI）

最終更新: 2026-10-20 / フェーズ1〜5の実装完了時点・ドキュメント作成時点

## 現在地

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | Supabase Auth ログイン | ✅ 完了・動作確認済 |
| 2 | Stripe決済・サブスク状態更新 | ✅ 実装済（キー未設定で未検証） |
| 3 | 店舗設定（強み・SEOキーワード）／レビュー履歴UI | ✅ 完了・動作確認済 |
| 4 | Google Business Profile OAuth連携・レビュー取得 | ✅ 実装済（未検証） |
| 5 | Geminiによる返信生成・Google APIへの投稿 | ✅ 実装済（未検証） |

実装済みだが**外部サービスの設定が必要で未検証**のものが残っています。

### 2026-10-20 追加実装（MVP必須3項目）

| 項目 | 状態 |
|---|---|
| 店舗設定「業種」（AIプロンプト反映） | ✅ 実装済 |
| 返信のON/Off切替（初期値OFF） | ✅ 実装済 |
| 自動返信バッチ（取得→生成→自動投稿） | ✅ 実装済 |
| 自動/手動の返信履歴の区別（`reviews.auto_replied`） | ✅ 実装済 |
| `vercel.json` のcron設定（1時間ごと） | ✅ Cloudflare cron（`wrangler.jsonc` の `triggers.crons`）へ移行済 |
| **新マイグレーションの適用**（`category` / `auto_reply_enabled` / `auto_replied` 列） | ✅ 適用済（2026-10-20 確認） |
| **新マイグレーションの適用**（`claimed_at` 列 / 返信履歴保持トリガー） | ⬜ 要対応（`20261020120400_add_claim_and_preserve_reply.sql`） |

---

## 0. ドキュメント

| 成果物 | パス | 状態 |
|---|---|---|
| 開発者向けREADME（アーキテクチャ・データモデル・API・検証手順） | `README.md` | ✅ 2026-10-20 作成 |
| 店舗利用者向け操作マニュアル | `docs/manual.md` | ✅ 2026-10-20 作成 |
| 公開ランディングページ | `src/app/page.tsx` | ✅ 2026-10-20 作成 |

- [x] ランディングページの表示をブラウザで確認（PC 1264px / モバイル 390px / ダークモード）
- [x] `docs/manual.md` のボタン名・エラーメッセージを実コードと突き合わせ

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

## 3. Gemini（フェーズ5）— AI返信生成

- [ ] `GEMINI_API_KEY` を `.env.local` に設定（[Google AI Studio](https://aistudio.google.com/apikey)）
- [ ] 低評価（1〜3点）→ SEOキーワードが入らないこと
- [ ] 高評価（4〜5点）→ 設定したSEOキーワードが自然に混入すること
- [ ] キーワード未設定店舗でも自然な文章になること
- [ ] 業種が設定されているとき、その業種に合った言い回しになること
      （2026-10-20: 手動投稿パスが `category` を渡していない不具合を修正。自動投稿パスは元から対応済み。実地確認は未実施）

**完了条件**: 4点・2点のレビューで上記2条件を満たす返信が生成・投稿される

---

## 4. レビュー自動取得（運用）

- [x] `CRON_SECRET` を `.env.local` / `.dev.vars` に設定（生成済み）
- [x] Cloudflareのcron（`wrangler.jsonc` の `triggers.crons`）で1時間ごとに `/api/reviews/sync` を実行
  - `worker.ts` の scheduled handler が `CRON_SECRET` 付きで内部呼び出し（Cloudflareのcronは認証ヘッダーを付けられないため）
  - ローカル発火確認: `curl http://127.0.0.1:8787/cdn-cgi/local/scheduled` → `[cron] /api/reviews/sync -> 200` を確認済み
- [ ] 本番デプロイ後、cronが実際に稼働していることを確認（Cloudflare ダッシュボードの Logs）
- [ ] 自動返信ONの店舗で、取得→自動生成→自動投稿まで通ることを確認
- [ ] 自動返信OFFの店舗では自動投稿されないことを確認
- [ ] レビュー一覧で「AIが自動で作成した返信」/「AIが作成した返信」の表示が正しいこと

---

## 5. 本番デプロイ（Cloudflare Workers）

- [x] OpenNext / wrangler の導入と設定（`open-next.config.ts` / `wrangler.jsonc` / `worker.ts` / `public/_headers`）
- [x] workerdローカルでの動作確認（`npm run preview`）— ログイン・設定保存・ルート保護・cronをすべて確認済み
- [ ] Cloudflare アカウントで **Workers Paid プラン** に加入（FreeはWorker 3MB・CPU 10ms制限で不足）
- [ ] `npx wrangler login`
- [ ] Secretを登録（`npx wrangler secret put <KEY>`）
      `SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` /
      `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `GOOGLE_TOKEN_ENCRYPTION_KEY` /
      `GEMINI_API_KEY` / `CRON_SECRET`
- [ ] `NEXT_PUBLIC_*` はビルド時にインライン化されるため、**ビルド時点の `.env.local`** に正しい値が入っていることを確認
- [ ] `npm run deploy` でデプロイ
- [ ] `supabase/setup-all.sql` を本番用Supabaseプロジェクトで実行
- [ ] `GOOGLE_TOKEN_ENCRYPTION_KEY` は本番・開発で**別の値**を生成する（開発時のままだとトークン復号に失敗する）
- [ ] Stripe Webhook のエンドポイントを本番ドメイン（`https://<domain>/api/stripe/webhook`）に変更
- [ ] 独自ドメインを設定（Workers → Settings → Domains）
- [ ] 確認: 未ログインリダイレクト／新規登録／設定保存／レビュー取得／決済

**注意**: 本番では Supabase の「Confirm email」をOFFのままにしない（未確認アカウントの攻撃リスクが増大）。開発時のみOFFにしてください。

**Cloudflare固有の制約**:
- Cache Components（`cacheComponents`）はworkerdと非互換のため**使用不可**。`await connection()` と `export const instant` も使わない
- Node.js middleware（`proxy.ts`）はCloudflare公式でexperimental（動作は確認済み）
- Windowsでのビルドは非推奨（WSL または GitHub Actions 推奨。`npm run deploy` はWindowsでも動作）

---

## 6. テストデータの掃除

- [ ] 検証用アカウント `phase3-e2e@example.jp`（パスワード `TestPass123!`）を Supabase → Authentication → Users から削除
- [ ] 残留した `shop_settings` 行を削除（アカウント削除で自動削除される）
- [ ] 本番前に `reviews` / `gbp_connections` が空であることを確認

---

## 7. セキュリティ・運用

- [ ] `SUPABASE_SERVICE_ROLE_KEY` はサーバー専用。クライアントへ渡っていないことを再確認
- [ ] `GOOGLE_TOKEN_ENCRYPTION_KEY` をパスワードマネージャなどで管理（失うと再連携が必要）
- [ ] エラー監視（Cloudflare Logs / Sentry等）の導入
- [ ] 店舗ごとの「AI返信が自動投稿される」ことを店舗자에게事前周知（公開レビューになる点）
- [ ] 自動投稿ではなく「生成→確認→投稿」の2段階にする案も検討（誤投稿リスク回避）

---

## 8. フェーズ4/5の実機検証で、随時

- [ ] Google APIのレスポンスで想定外のフィールド（例: `reviewMediaItems` 付きレビュー）を確認
- [ ] 店舗が複数ある場合の表示と切り替え（現在は全店舗を自動登録）
- [ ] レビュー数が50件を超える場合のページング（現状は最新50件のみ取得）

---

## 9. コードレビュー所見（2026-10-20）

全ソース（49 TS/TSX + マイグレーションSQL + Worker設定）を精査した結果。
優先度の高い順に並べる。**修正コードはまだ書いていない。**

### 優先順位の目安（未対応の全項目）

> **2026-10-21 追記**: 下の段階 P0〜P5 の全項目は対応済みです。残っているのは**手作業**と、
> [2026-10-21 の追加コードレビュー](#11-追加コードレビュー所見2026-10-21)で新たに挙がった項目のみです。

| 段階 | 内容 | 対象ID | 状態 |
|---|---|---|---|
| **P0** | 公開レビューが意図しない内容に置き換わる／上書きされる | R1, R2, R10 | ✅ 修正済（2026-10-21） |
| **P1** | 機能が黙って動く／壊れても分からない | R3, R4, M11 | ✅ 修正済（2026-10-21） |
| **P2** | セキュリティの露出とレベニューリスク | M5, M10, M4 | ✅ 修正済（2026-10-21） |
| **P3** | プロンプトの整形と処理量の制限 | R5, R6, R7, M9 | ✅ 修正済（2026-10-21） |
| **P4** | 誤誘導・UXの粗さ | R8, R9, L9, L8, L1 | ✅ 修正済（2026-10-21） |
| **P5** | 低リスクの整備 | L4, L5, L6, L7, L12, L13 | ✅ 修正済（2026-10-21） |

### 手作業（コードを書かない作業）

| 段階 | 内容 |
|---|---|
| **即** | Supabase SQL Editor でマイグレーション2件を適用（`20261020120400` / `20261020120500`。クリップボードに済み） |
| **即** | 本番に `APP_URL` を登録（`npx wrangler secret put APP_URL`）。未設定だと決済とメール確認が動かない |
| **外部** | Stripe のキー設定、Google Cloud の Business Profile API とOAuth同意画面、Geminiキー、本番 `CRON_SECRET` |
| **外部** | Cloudflare Workers Paid への加入と `supabase/setup-all.sql` の本番適用 |
| **外部** | Googleのアクセス承認（審査）が実店舗提供の前提 |

### Critical / High

- [x] **C1. 課金ゲートが存在しない** — `subscription_status` はダッシュボードのバッジ表示（`src/app/(app)/dashboard/page.tsx:64`）でしか読まれず、`generateAndPostReply` / `autoReplyPendingReviews` / `syncReviews` のいずれにも判定がない。登録すれば無料で公開レビューを投稿できる
      → **修正済（2026-10-20）**。`src/lib/billing.ts` を新設し `isSubscribed()` / `isAccessibleStatus()` / `mapStripeSubscriptionStatus()` を集約。`syncReviews` / `autoReplyPendingReviews` / `generateAndPostReply` / `syncReviewsAction` の4箇所をゲート。`/reviews` と `/settings` には未契約時の案内バナー（`SubscriptionNotice`）を表示。契約状態の読み取り失敗時は fail-closed。`scripts/verify-paywall.ts` でライブDB検証済み（22/22 PASS）、ブラウザで未契約/契約中の両方のUIを確認済み
- [x] **C2. 再同期で返信履歴が消え、同一レビューに二重投稿される** — `src/lib/google/reviews.ts:35-36` の upsert が `reply_text` を GBP 応答で上書きする。GBP が `reviewReply` を返さないと `reply_text = NULL` になり、`src/lib/google/auto-reply.ts:30` の `.is("reply_text", null)` が把它を未返信として再生成・再投稿する（公開レビューが上書きされる）。`auto_replied` は upsert 列に無いため `auto_replied=true / reply_text=NULL` という不整合な行が残る
      → **修正済（2026-10-20）**。アプリ層で既存の `reply_text` / `replied_at` を持ち越すように変更（`src/lib/google/reviews.ts`）。加えてDB層のトリガー `reviews_preserve_reply` で強制（マイグレーション `20261020120400_add_claim_and_preserve_reply.sql`）。`scripts/verify-reply-idempotency.ts` でライブDB検証済み（6/6 PASS）
- [x] **C3. 1つの連携が壊れると、そのユーザーの自動返信が完全停止する** — `src/lib/google/reviews.ts:17-19` の接続ループで `getValidAccessToken()` が例外を投げると、残りロケーションの処理が中断される。さらに `src/app/api/reviews/sync/route.ts:28-32` では `syncReviews` と `autoReplyPendingReviews` が同じ `try` にあるため、同期が失敗すると自動返信が呼ばれない
      → **修正済（2026-10-20）**。`syncReviews()` を接続単位の try/catch に変更し、失敗を `failures` に記録して残りの店舗は続行。cron（`/api/reviews/sync`）と `syncReviewsAction()` は取得と自動返信の try を分離し、取得が失敗しても自動返信は必ず実行。自動返信は店舗ごとにアクセストークンを1回だけ取得
- [x] **C4. 失効したリフレッシュトークンが永久に再試行される** — `src/lib/google/connections.ts:87` の `refreshAccessToken` は `invalid_grant` を判別せず、`src/lib/google/oauth.ts:53-55` で汎用エラーに潰される。`gbp_connections` に無効フラグが無く、毎時同じ壊れたトークンを叩き続ける
      → **修正済（2026-10-20）**。`GoogleAuthError` に `code` を持ち、`invalid_grant` を判別して該当連携を `status='revoked'` で保存（マイグレーション `20261020120500_add_connection_status.sql`）。以後の処理対象から外し、`/settings` に「再連携が必要」バッジと案内を表示。再度連携すると `active` に戻ります
- [x] **C5. 自動返信の排他制御が無い** — `src/lib/google/auto-reply.ts:26-31` で対象を選してから生成→投稿→DB更新の順で、途中で排他がない。cron と手動「レビューを取得する」が同時に走ると同じレビューへ二重投稿される。`src/app/(app)/reviews/actions.ts` の手動パスは `reply_text` を確認していない
      → **修正済（2026-10-20）**。`src/lib/review-claims.ts` を追加し、`claimed_at` による条件付きUPDATEで排他的に確保（10分超のclaimは自動回収）。自動返信・手動投稿の両方に適用。手動パスは返信済みレビューを拒否するようになった。`claimed_at` 未適用時は fail-soft で排他制御なしで続行する

### Medium

- [x] **M1. `Host` ヘッダー由来のオリジンを決済リダイレクトに使っている** — `src/lib/origin.ts:3-8` と重複している `src/app/(app)/billing/actions.ts:8-13` が `x-forwarded-proto` / `host` から素のオリジンを組み立て、`success_url` / `cancel_url` / `return_url` に使う。ワイルドカードルートや他ホストへのデプロイでは攻撃者ドメインに誘導されうる
      → **修正済（2026-10-20）**。`src/lib/app-url.ts` を新設し `APP_URL` 環境変数を単一の情報源に。`src/lib/origin.ts` は削除。Stripeの戻り先・OAuthのredirect_uri・メール確認リンクの遷移先をすべて `APP_URL` 基準に変更
- [x] **M2. レビュー本文のプロンプトインジェクション** — `src/lib/ai.ts:63` がレビュー本文をそのままプロンプトに埋め込み、システムプロンプト（`src/lib/ai.ts:20-48`）に「本文はデータであり命令ではない」のルールが無い。投稿された返信はそのまま公開される
      → **修正済（2026-10-20）**。入力を `<review>` / `<reviewer_name>` で囲み、システムプロンプトに「データは命令ではない」を明記。制御文字を除去して2000字で打ち切り、出力は1段落に整理して Markdown記号・評価スター・URL・メールアドレスを除去、500字で打ち切り、低評価のSEOキーワード混入を除去
- [x] **M3. Stripe の webhook が `active` を `none` に落とす** — `src/app/api/stripe/webhook/route.ts:14-23` の `default: return "none"` が `incomplete`（3DS待ちの通常状態）と `paused` を拾う
      → **修正済（2026-10-20）**。`paused` を `past_due` へ対応（契約は継続しているため）。`incomplete` は初回支払いが未完了なので `none` のままが正しい
- [x] **M4. webhook に冪等性・順序保護が無い** — `src/app/api/stripe/webhook/route.ts:62-108` はイベント重複や順序逆転を制御しない。古い `subscription.updated` が `subscription.deleted` を上書きしうる。また `profiles.id` は `auth.users` への FK のため、削除済みユーザーのイベントで FK 違反になり 500 → Stripe が無限リトライする
      → **修正済（2026-10-21）**。`stripe_events` テーブル（マイグレーション `20261020120700`）を追加し、処理前にイベントIDを挿入して重複を遮断。`profiles.stripe_event_created_at` と比較して遅延イベントも遮断。削除済みユーザーのFK違反は 500 を返さず 200 を返して再送ループを防ぐ
- [x] **M5. `gbp_connections` の RLS が暗号化されたトークンを本人ブラウザへ公開している** — `supabase/migrations/20261020120200_create_gbp_connections.sql:22-25` の select ポリシーで `access_token` / `refresh_token` も読める。アプリ側は admin クライアントしか使っていない（`src/lib/google/connections.ts:22`）ため不要
      → **修正済（2026-10-21）**。マイグレーション `20261020120600` で `revoke select from authenticated` に加え、列単位の `grant select (...)` に変更。service_role は影響を受けません
- [x] **M6. 認証解決が1リクエストに2〜4回** — `src/proxy.ts:30` ＋ `src/app/(app)/layout.tsx:13` ＋ 各ページで `supabase.auth.getUser()` を個別に呼び、毎回ネットワーク往復が発生する。proxy の matcher は `/api/*` も含み、Stripe webhook と cron も無意味に認証付出的
      → **修正済（2026-10-20）**。`src/lib/auth.ts` に `React.cache()` でメモ化した `getUser()` を用意し、レイアウトと各ページから使用。proxy の matcher から `/api/stripe/webhook` と `/api/reviews/sync` を除外
- [x] **M7. SEOキーワードの往復で壊れる** — `src/components/settings/shop-settings-form.tsx:178` が `join(",")`、`src/app/(app)/settings/actions.ts:36-40` が `split(",")`。カンマを含むキーワードは分割され、30文字上限はクライアント側 `maxLength` のみ（サーバー側では無制限）
      → **修正済（2026-10-20）**。`src/lib/seo-keywords.ts` を新設し、JSONで往復。サーバー側で件数（最大20）と1語あたりの長さ（最大30）を検証し、超過分は除外。旧形式（カンマ区切り）も読み取れる
- [x] **M8. `GEMINI_MODEL` が空文字だと空のモデル名が送信される** — `src/lib/ai.ts:73` の `??` は空文字に効かない。加えて `src/lib/ai.ts:81-84` が上流ステータスを潰すため、失敗原因が分からない
      → **修正済（2026-10-20）**。`process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL` に変更し、`GEMINI_API_KEY` も trim して判定。エラーに上流のステータスと本文（200字まで）を含めるようにした
- [x] **M9. cron が全ユーザーを1回の Worker 実行で逐次処理する** — `src/app/api/reviews/sync/route.ts:26-36`。ユーザー数が増えると Worker の時間上限で途中強制終了し、処理済みの記録が残る
      → **修正済（2026-10-21）**。`src/lib/google/sync-batch.ts` に `USERS_PER_RUN`（既定20）を置き、時刻ベースで開始位置を回転させて毎回違うユーザーを処理する。cron の応答に `totalUsers` / `processedUsers` を含めて残量が見えるようにした
- [x] **M10. 二重契約の防止がない** — `src/app/(app)/billing/actions.ts:36-66` は顧客のみを検索し、既存の契約を確認しない。顧客IDが未反映の状態で「契約する」を2回押すと二重契約になりうる。Checkout Session に冪等キーも無い
      → **修正済（2026-10-21）**。Checkout Session を作る前に `stripe.subscriptions.list({status: "active"})` で既存契約を確認し、あればBilling Portalへ送る。Session 作成には冪等キー `checkout:{userId}:{customerId}` を付与
- [x] **M11. OAuth コールバックが全エラーを握りつぶす** — `src/app/api/google/oauth/callback/route.ts:65-67` は `catch {}` で何もログに出さない。`src/lib/google/oauth.ts:53-55` と `src/lib/google/business.ts:43-45` も上流のレスポンス本文を捨てる
      → **修正済（2026-10-21）**。トークン交換・店舗取得・保存の各段階で分けて `console.error` に出すようにし、`GoogleAuthError.code`（`invalid_grant` など）も一緒に残す。リダイレクトは try の外に移して握りつぶさない
- [x] **M12. `checkout.session.completed` が契約状態を更新しない** — `src/app/api/stripe/webhook/route.ts:63-78` は `stripe_customer_id` と `email` のみ書き、`subscription_status` は後続の subscription イベント頼み。支払い済みでも一瞬「未契約」と表示される
      → **修正済（2026-10-20）**。`payment_status === "paid"` のとき `subscription_status: "active"` を書き込むようにした

### Low

- [x] **L1. エラーバウンダリ・loading が無い** — `src/app/**` に `error.tsx` / `global-error.tsx` / `loading.tsx` / `not-found.tsx` が存在しない。`src/app/error/page.tsx` はルートであってエラーバウンダリではない
- [x] **L2. `getOrigin()` の重複** — `src/lib/origin.ts` と `src/app/(app)/billing/actions.ts:8-13` が同一実装
      → **修正済（2026-10-20）**。M1 の対応で `src/lib/origin.ts` を削除し `src/lib/app-url.ts` に一本化
- [x] **L3. `SubscriptionStatus` の vocabulary is defined in four places and can drift from the DB CHECK** — `src/app/api/stripe/webhook/route.ts:7` (`type SubscriptionStatus`), `src/app/(app)/dashboard/page.tsx:40-44` (`parseStatus`), `src/components/billing/plan-card.tsx:8-9`, and `supabase/migrations/20261019120000_create_profiles.sql:14-15` (CHECK constraint). Export one type + one mapping from `src/lib/stripe.ts` and reuse it in all three TS locations.
      → **修正済（2026-10-20）**。`src/lib/billing.ts` に型・解析・マッピングを集約し、webhook / dashboard / plan-card から参照するようにした
- [x] **L4. proxy の保護対象が `/dashboard` のみ** — `src/proxy.ts:33`。`/settings` と `/reviews` は `(app)` レイアウト側に依存
- [x] **L5. proxy の matcher が CSS/JS も通す** — `src/proxy.ts:48-51` の除外パターンが狭く、`.css` / `.js` / `.woff2` が認証チェックを通る
- [x] **L6. `GET /api/reviews/sync` が状態を変更する** — `src/app/api/reviews/sync/route.ts:46-48`。認証ヘッダー必須なので CSRF は起きないが、POST のみにすべき
- [x] **L7. `CRON_SECRET` は Wrangler Secret 前提** — `worker.ts:32-34` は `env.CRON_SECRET`（binding）を読み、ルートは `process.env.CRON_SECRET` を読む。`.env.local` だけに設定して `wrangler secret put` を忘れると cron だけが静かに動かない
- [ ] **L8. 未知の starRating でレビューが落ちる** — `src/lib/google/business.ts:106-110` が 0 を返し、`src/lib/google/reviews.ts:23-24` がその行を捨てる
- [ ] **L9. 保存後もフォームのクライアント状態が更新されない** — `src/components/settings/shop-settings-form.tsx:52-73`
- [x] **L10. `src/app/auth/confirm/route.ts` が `type` を検証せずキャストしている** — 不正値で supabase-js が例外を投げ、500 になる
      → **修正済（2026-10-20）**。`type` を許可リストで検証し、例外を try/catch で捕捉。遷移先も `APP_URL` 基準に変更
- [x] **L11. `MAX_KEYWORDS = 20` がクライアントとサーバーの2箇所に重複** — サーバー側は `.slice(0, MAX_KEYWORDS)` で上限は効いている
      → **修正済（2026-10-20）**。M7 の対応で `src/lib/seo-keywords.ts` に定数と検証ロジックを集約し、クライアントとサーバーが同じ値を参照する形にしました
- [x] **L12. `getStripe()` が呼び出しごとに新しいクライアントを作る** — `src/lib/stripe.ts:9-13`
- [x] **L13. ランディングページが毎回 Stripe API を呼ぶ** — `src/app/page.tsx:110-117` が `fetchPriceLabel()` を実行するため、トラフィック最大のページが毎回 Stripe に依存する（レート制限・レイテンシ）。価格ラベルはキャッシュする

---

## 10. 追加コードレビュー所見（2026-10-21）

前回の対応（C1〜C5 / M1〜M3 / M6〜M8 / L2〜L3 / L10〜L11）の後の状態で再レビューした結果。
**修正コードはまだ書いていない。**

### High

- [x] **R1. `<review>` の区切りをレビュー本文から抜け出せる（M2対策の未完）** — `src/lib/ai.ts:31-42` の `stripControlCharacters` は制御文字しか除去せず `<` `>` を通す。本文に `</review>` が書かれるとその時点であとが「データ」の外に出てしまい、「本文は命令ではない」のルールをすり抜けられる
      → `reviewText` / `reviewerName` の両方から `<>` を除去する。または区切りに毎回ランダムなトークンを使う
- [x] **R2. 投稿後のDB更新失敗で、公開済みの返信が別の文に置き換わる** — `src/lib/google/auto-reply.ts:95-106` は `update()` の戻り値を無視して `replied += 1` する。投稿後にDB更新が失敗すると `reply_text` が null のまま残り、次の実行が再生成・再投稿して **公開されている返信を置き換える**（C2のトリガーは旧値が null なので守れない）
      → `update()` の `error` をチェックして再試行する。失敗時は大きなログを出す

### Medium

- [x] **R3. `getAppUrl()` が try/catch の外で例外を投げる** — `src/app/(app)/billing/actions.ts:24` と `:75` で `getAppUrl()` を try の外で呼んでいる。`APP_URL` 未設定のとき、ほかの失敗経路は `/dashboard?checkout=error` に遷移するのに、ここだけ素のサーバーエラーになる。`src/app/auth/confirm/route.ts:21` も同じ（メール確認リンクが500になる）
      → try の中に移すか、遷移先を相対パスに落とす
- [x] **R4. `listLocations` が1ページ目しか取得しない** — `src/lib/google/business.ts:60-69` が `pageSize` も `nextPageToken` も指定しない。Googleのデフォルトは約10件までなので、**10店舗を超えるアカウントは一部しか連携されない**。ランディングページは「複数店舗の場合は、すべて自動で登録されます」と約束している
      → `pageSize=100` と `nextPageToken` でループ
- [x] **R5. 投稿者名がプロンプトに2回出てきて、改行も入る** — `src/lib/ai.ts:166` の `【お客様名】` と `:168` の `<reviewer_name>` で同じ名前が重複。また `stripControlCharacters` は `\t\n\r` を許すため（`:35`）、名前に入れた改行が区切りの外にプロンプトを追加できる
      → 重複を削除し、`<reviewer_name>` にのみ置く。投稿者名は `\r\n\t` も除去する

### Low

- [x] **R6. 店舗名・業種・強み・キーワードが未整形のまま埋め込まれる** — `src/lib/ai.ts:161-164` はレビュー本文と違い、制御文字除去も区切りもしていない。`<review>` や `【評価】` を含む設定値はM2の区切りを内側から壊せる（店主自身の設定なので被害は自己に及ぶが、システムプロンプトの前提が崩れる）
      → 4項目にも `stripControlCharacters` と括弧除去をかける
- [x] **R7. 自動返信が1回あたり無制限** — `src/lib/google/auto-reply.ts:36-53` の pending クエリが `limit()` を持たず、未返信全件を1つのWorker実行で処理する（1件ごとにGemini呼び出しとGBPのPUT）。蓄積した店舗でGeminiの利用量が膨らみ、Workerの時間上限に達しうる（M9 に類似）
      → `limit()` を入れ、残りは次回の実行に回す
- [x] **R8. 連携が全て失効しているのに「まだ連携されていません」と出る** — `src/app/(app)/settings/actions.ts:106-111` は `listActiveConnections` が空のとき「Googleマップがまだ連携されていません。先に連携してください。」を返す。失効（revoked）だけの店舗がある場合、これは誤った誘導になる（`/settings` の画面側は失効バナーを出している）
      → 連携はあるが全て失効のときは、再連携を促す文言に変える
- [x] **R9. 店主がGoogleマップ上で直接書いた返信が「AIが作成した返信」と表示される** — `src/components/reviews/review-list.tsx:101` は `auto_replied` が false なら「AIが作成した返信」と表示する。GBPから同期した `reply_text`（店主がGoogle上で直接書いたもの）は `auto_replied = false` のためAI作成と誤表示される
      → 出所フラグを持つか、`auto_replied` が false なら中立的な「返信済み」と表示する
- [x] **R10. 手動投稿が、店主がGoogle上で書いた更新された返信を上書きしうる** — `src/app/(app)/reviews/actions.ts:53-58` はローカルの `reply_text` しかない。最後の同期以降に店主がGoogle上で返信していた場合、その返信をAIの文で上書きする
      → 投稿直前にGBPから現在の返信を読み、既に返信があれば中止する

---

## 完了確認コマンド

```bash
npm run lint
# メモリ不足（Zone Allocation failed）で失敗する場合は
set NODE_OPTIONS=--max-old-space-size=6144 && npm run build   # Windows (cmd)
NODE_OPTIONS=--max-old-space-size=6144 npm run build         # macOS / Linux
```

---

## 参考: 開発環境メモ

- `next dev` は `http://127.0.0.1:3000` だと `allowedDevOrigins` 設定が無いとReactがハイドレーションされない（`next.config.ts` で設定済み）
- Supabaseは `example.com` などの予約ドメインを新規登録に拒否する（テスト時は実在ドメインを使う）
- DBマイグレーションは `supabase/setup-all.sql` をSQL Editorで実行すれば何度でも再実行できる
