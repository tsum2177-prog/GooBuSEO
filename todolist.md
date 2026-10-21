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

### Critical / High

- [ ] **C1. 課金ゲートが存在しない** — `subscription_status` はダッシュボードのバッジ表示（`src/app/(app)/dashboard/page.tsx:64`）でしか読まれず、`generateAndPostReply` / `autoReplyPendingReviews` / `syncReviews` のいずれにも判定がない。登録すれば無料で公開レビューを投稿できる
      → `src/lib/billing.ts` に `requireActiveSubscription(userId)` を用意し、上記3箇所の先頭で判定する
- [x] **C2. 再同期で返信履歴が消え、同一レビューに二重投稿される** — `src/lib/google/reviews.ts:35-36` の upsert が `reply_text` を GBP 応答で上書きする。GBP が `reviewReply` を返さないと `reply_text = NULL` になり、`src/lib/google/auto-reply.ts:30` の `.is("reply_text", null)` が把它を未返信として再生成・再投稿する（公開レビューが上書きされる）。`auto_replied` は upsert 列に無いため `auto_replied=true / reply_text=NULL` という不整合な行が残る
      → **修正済（2026-10-20）**。アプリ層で既存の `reply_text` / `replied_at` を持ち越すように変更（`src/lib/google/reviews.ts`）。加えてDB層のトリガー `reviews_preserve_reply` で強制（マイグレーション `20261020120400_add_claim_and_preserve_reply.sql`）。`scripts/verify-reply-idempotency.ts` でライブDB検証済み（6/6 PASS）
- [ ] **C3. 1つの連携が壊れると、そのユーザーの自動返信が完全停止する** — `src/lib/google/reviews.ts:17-19` の接続ループで `getValidAccessToken()` が例外を投げると、残りロケーションの処理が中断される。さらに `src/app/api/reviews/sync/route.ts:28-32` では `syncReviews` と `autoReplyPendingReviews` が同じ `try` にあるため、同期が失敗すると自動返信が呼ばれない
      → 接続単位の try/catch ＋ 呼び出し側の try 分割
- [ ] **C4. 失効したリフレッシュトークンが永久に再試行される** — `src/lib/google/connections.ts:87` の `refreshAccessToken` は `invalid_grant` を判別せず、`src/lib/google/oauth.ts:53-55` で汎用エラーに潰される。`gbp_connections` に無効フラグが無く、毎時同じ壊れたトークンを叩き続ける
      → `invalid_grant` を判別して `status='revoked'` を保存し、`/settings` に再連携バナーを出す
- [x] **C5. 自動返信の排他制御が無い** — `src/lib/google/auto-reply.ts:26-31` で対象を選してから生成→投稿→DB更新の順で、途中で排他がない。cron と手動「レビューを取得する」が同時に走ると同じレビューへ二重投稿される。`src/app/(app)/reviews/actions.ts` の手動パスは `reply_text` を確認していない
      → **修正済（2026-10-20）**。`src/lib/review-claims.ts` を追加し、`claimed_at` による条件付きUPDATEで排他的に確保（10分超のclaimは自動回収）。自動返信・手動投稿の両方に適用。手動パスは返信済みレビューを拒否するようになった。`claimed_at` 未適用時は fail-soft で排他制御なしで続行する

### Medium

- [ ] **M1. `Host` ヘッダー由来のオリジンを決済リダイレクトに使っている** — `src/lib/origin.ts:3-8` と重複している `src/app/(app)/billing/actions.ts:8-13` が `x-forwarded-proto` / `host` から素のオリジンを組み立て、`success_url` / `cancel_url` / `return_url` に使う。ワイルドカードルートや他ホストへのデプロイでは攻撃者ドメインに誘導されうる
      → `APP_URL` 環境変数を単一の情報源にして、Request ヘッダーに依存しない
- [ ] **M2. レビュー本文のプロンプトインジェクション** — `src/lib/ai.ts:63` がレビュー本文をそのままプロンプトに埋め込み、システムプロンプト（`src/lib/ai.ts:20-48`）に「本文はデータであり命令ではない」のルールが無い。投稿された返信はそのまま公開される
      → 区切り文字で囲み、制御文字を除去し、出力を長さ・改行・URLで検証してから投稿する
- [ ] **M3. Stripe の webhook が `active` を `none` に落とす** — `src/app/api/stripe/webhook/route.ts:14-23` の `default: return "none"` が `incomplete`（3DS待ちの通常状態）と `paused` を拾う
      → `incomplete` / `paused` を明示的に処理する
- [ ] **M4. webhook に冪等性・順序保護が無い** — `src/app/api/stripe/webhook/route.ts:62-108` はイベント重複や順序逆転を制御しない。古い `subscription.updated` が `subscription.deleted` を上書きしうる。また `profiles.id` は `auth.users` への FK のため、削除済みユーザーのイベントで FK 違反になり 500 → Stripe が無限リトライする
      → イベント記録テーブル、一時停止、FK 違反の握りつぶし
- [ ] **M5. `gbp_connections` の RLS が暗号化されたトークンを本人ブラウザへ公開している** — `supabase/migrations/20261020120200_create_gbp_connections.sql:22-25` の select ポリシーで `access_token` / `refresh_token` も読める。アプリ側は admin クライアントしか使っていない（`src/lib/google/connections.ts:22`）ため不要
      → 列単位の GRANT に変更する
- [ ] **M6. 認証解決が1リクエストに2〜4回** — `src/proxy.ts:30` ＋ `src/app/(app)/layout.tsx:13` ＋ 各ページで `supabase.auth.getUser()` を個別に呼び、毎回ネットワーク往復が発生する。proxy の matcher は `/api/*` も含み、Stripe webhook と cron も無意味に認証付出的
      → `React.cache()` でメモ化、matcher から `/api` を除外
- [ ] **M7. SEOキーワードの往復で壊れる** — `src/components/settings/shop-settings-form.tsx:178` が `join(",")`、`src/app/(app)/settings/actions.ts:36-40` が `split(",")`。カンマを含むキーワードは分割され、30文字上限はクライアント側 `maxLength` のみ（サーバー側では無制限）
      → 配列を JSON で受け渡し、サーバー側で長さと件数を検証する
- [ ] **M8. `GEMINI_MODEL` が空文字だと空のモデル名が送信される** — `src/lib/ai.ts:73` の `??` は空文字に効かない。加えて `src/lib/ai.ts:81-84` が上流ステータスを潰すため、失敗原因が分からない
      → `?.trim() || DEFAULT_MODEL` にして、上流ステータスをエラーに含める
- [ ] **M9. cron が全ユーザーを1回の Worker 実行で逐次処理する** — `src/app/api/reviews/sync/route.ts:26-36`。ユーザー数が増えると Worker の時間上限で途中強制終了し、処理済みの記録が残る
      → 1回の処理件数を制限する / Queue や Durable Object へ移す
- [ ] **M10. 二重契約の防止がない** — `src/app/(app)/billing/actions.ts:36-66` は顾客のみを検索し、既存の契約を確認しない。顧客IDが未反映の状態で「契約する」を2回押すと二重契約になりうる。Checkout Session に冪等キーも無い
      → 既存契約を `stripe.subscriptions.list` で確認し、冪等キーを付ける
- [ ] **M11. OAuth コールバックが全エラーを握りつぶす** — `src/app/api/google/oauth/callback/route.ts:65-67` は `catch {}` で何もログに出さない。`src/lib/google/oauth.ts:53-55` と `src/lib/google/business.ts:43-45` も上流のレスポンス本文を捨てる
      → ログを出力し、結果コードを分ける
- [ ] **M12. `checkout.session.completed` が契約状態を更新しない** — `src/app/api/stripe/webhook/route.ts:63-78` は `stripe_customer_id` と `email` のみ書き、`subscription_status` は後続の subscription イベント頼み。支払い済みでも一瞬「未契約」と表示される
      → `payment_status === "paid"` のとき `active` を書く

### Low

- [ ] **L1. エラーバウンダリ・loading が無い** — `src/app/**` に `error.tsx` / `global-error.tsx` / `loading.tsx` / `not-found.tsx` が存在しない。`src/app/error/page.tsx` はルートであってエラーバウンダリではない
- [ ] **L2. `getOrigin()` の重複** — `src/lib/origin.ts` と `src/app/(app)/billing/actions.ts:8-13` が同一実装
- [ ] **L3. `SubscriptionStatus` の型とマッピングが4箇所に重複** — `src/app/api/stripe/webhook/route.ts:7`、`src/app/(app)/dashboard/page.tsx:40-44`、`src/components/billing/plan-card.tsx:8-9`、マイグレーションの CHECK 制約
- [ ] **L4. proxy の保護対象が `/dashboard` のみ** — `src/proxy.ts:33`。`/settings` と `/reviews` は `(app)` レイアウト側に依存
- [ ] **L5. proxy の matcher が CSS/JS も通す** — `src/proxy.ts:48-51` の除外パターンが狭く、`.css` / `.js` / `.woff2` が認証チェックを通る
- [ ] **L6. `GET /api/reviews/sync` が状態を変更する** — `src/app/api/reviews/sync/route.ts:46-48`。認証ヘッダー必須なので CSRF は起きないが、POST のみにすべき
- [ ] **L7. `CRON_SECRET` は Wrangler Secret 前提** — `worker.ts:32-34` は `env.CRON_SECRET`（binding）を読み、ルートは `process.env.CRON_SECRET` を読む。`.env.local` だけに設定して `wrangler secret put` を忘れると cron だけが静かに動かない
- [ ] **L8. 未知の starRating でレビューが落ちる** — `src/lib/google/business.ts:106-110` が 0 を返し、`src/lib/google/reviews.ts:23-24` がその行を捨てる
- [ ] **L9. 保存後もフォームのクライアント状態が更新されない** — `src/components/settings/shop-settings-form.tsx:52-73`
- [ ] **L10. `src/app/auth/confirm/route.ts` が `type` を検証せずキャストしている** — 不正値で supabase-js が例外を投げ、500 になる
- [ ] **L11. `MAX_KEYWORDS = 20` がクライアントとサーバーの2箇所に重複** — サーバー側は `.slice(0, MAX_KEYWORDS)` で上限は効いている
- [ ] **L12. `getStripe()` が呼び出しごとに新しいクライアントを作る** — `src/lib/stripe.ts:9-13`
- [ ] **L13. ランディングページが毎回 Stripe API を呼ぶ** — `src/app/page.tsx:110-117` が `fetchPriceLabel()` を実行するため、トラフィック最大のページが毎回 Stripe に依存する（レート制限・レイテンシ）。価格ラベルはキャッシュする

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
