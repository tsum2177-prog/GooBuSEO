import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  MapPin,
  ScanSearch,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { Faq } from "@/components/landing/faq";
import { ReviewProof } from "@/components/landing/review-proof";
import { SiteHeader } from "@/components/landing/site-header";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { fetchPriceLabel } from "@/lib/stripe";

export const metadata: Metadata = {
  title: {
    absolute: "レビュー返信AI | Googleマップの口コミに、AIが返信する",
  },
  description:
    "Googleマップのレビューを1時間ごとに取得し、点数に応じて返事を書き分けて投稿します。低評価には誠実に謝罪と改善案、高評価には店舗の強みを自然に。ローカル店舗向けのレビュー返信自動化ツール。",
  openGraph: {
    title: "レビュー返信AI | Googleマップの口コミに、AIが返信する",
    description:
      "Googleマップのレビューを1時間ごとに取得し、点数に応じて返事を書き分けて投稿します。低評価には誠実に謝罪と改善案、高評価には店舗の強みを自然に。",
    type: "website",
    locale: "ja_JP",
  },
};

export const dynamic = "force-dynamic";

const reasons = [
  {
    title: "営業中は手が離せない",
    body: "スタッフがレジや厨房にいる間は、レビューへの返信に手を回せません。気づけば数週間が過ぎ、低評価のレビューがそのまま残ります。",
  },
  {
    title: "何を書けばいいか分からない",
    body: "レビューごとにゼロから文章を考えると、どこから書き始めればよいか分からず、いつのまにか手を出さなくなります。定型文を使っても、外から見た印象は薄くなります。",
  },
  {
    title: "返信のある店舗は印象が違う",
    body: "Googleマップでは、投稿されたレビューと店舗からの返信がセットで表示されます。返信のある店舗とない店舗では、外から見た印象が変わります。",
  },
];

const steps = [
  {
    title: "Googleマップと連携する",
    body: "アカウント作成後、「Googleマップと連携する」を押してGoogleのログイン画面へ進み、お持ちの店舗を選びます。複数店舗をお持ちの場合は、すべて自動で登録されます。",
  },
  {
    title: "店舗情報を登録する",
    body: "店舗名、業種、店舗の特徴、SEOキーワードの4項目。AIが返信文を書くときの材料になります。業種は飲食店・美容院・歯科医院など7種類から選べます。",
  },
  {
    title: "取得して、返信する",
    body: "1時間ごとに自動でレビューを取得します。手動で「レビューを取得する」を押してもかまいません。レビュー一覧から「AI返信を作成して投稿」で、そのままGoogleマップへ公開されます。",
  },
];

const features = [
  "Googleマップとの連携（複数店舗対応）",
  "1時間ごとのレビュー自動取得（1店舗につき最新200件）",
  "点数で書き分けるAI返信生成",
  "Googleマップへの返信投稿",
  "店舗設定（業種・強み・SEOキーワード最大20個）",
  "自動返信のON / OFF切り替え",
];

const faqItems = [
  {
    question: "どのレビューが取得されますか？",
    answer:
      "Googleマップと連携した店舗のレビューです。1店舗につき最新200件が対象で、1時間ごとに取得します。200件を超える場合、古いレビューは自動取得の対象になりません。",
  },
  {
    question: "自動で返信が投稿されますか？",
    answer:
      "初期状態では自動投稿されません。自動返信スイッチはOFFが初期値で、レビュー一覧から「AI返信を作成して投稿」を押して初めて公開されます。スイッチをONにすると、取得したレビューには自動で投稿されます。",
  },
  {
    question: "AIが書いた文は、そのまま公開されますか？",
    answer:
      "はい。生成された文はそのままGoogleマップの返信として公開されます。自動投稿を避けたい場合は、自動返信スイッチをOFFにしたまま手動で投稿してください。URLや記号、装飾が入らないよう整えてから投稿します。",
  },
  {
    question: "どんな情報がAIに使われますか？",
    answer:
      "店舗設定で入力した店舗名・業種・店舗の特徴・SEOキーワードと、対象のレビュー（本文・評価・投稿者名）のみです。他の店舗や利用者の情報は使いません。",
  },
  {
    question: "店舗は複数登録できますか？",
    answer:
      "はい。1つのアカウントで複数の店舗を連携できます。Googleマップとの連携時に、お使いのアカウントで管理しているすべての店舗が自動登録されます。店舗数が多くても取りこぼしません。",
  },
  {
    question: "返信を1回に何件まで投稿しますか？",
    answer:
      "自動返信は1回の実行につき最大20件まで投稿します。残りは次の実行に回ります。1時間ごとに自動で実行されるため、件数が多くても1日で少しずつ追いつきます。",
  },
  {
    question: "「AIが作成した返信」と「AIが自動で作成した返信」は何が違いますか？",
    answer:
      "お手元で「AI返信を作成して投稿」を押したものが前者、自動返信スイッチがONの状態で自動で投稿されたものが後者です。AIが書いたものではない返信にはラベルを表示しません。",
  },
  {
    question: "自分でGoogleマップに返信を書いたらどうなりますか？",
    answer:
      "最後の取得以降にご自身で返信を書いた場合、レビュー返信AIが上書きしてしまわないよう、投稿を中止します。そのレビューは「返信済み」として扱われます。",
  },
  {
    question: "うまくいかなかったときはどうすればよいですか？",
    answer:
      "操作の途中でエラーが出た場合は、エラー画面の「もう一度試す」を押してください。ページの表示に失敗した場合もエラー画面に移動します。続かない場合はお問い合わせください。",
  },
  {
    question: "Googleマップとの連携に制約はありますか？",
    answer:
      "GoogleのBusiness Profile APIの利用には、Googleによるアクセス承認（審査）が必要です。審査前の段階では、ご自身のアカウントで管理している店舗のみが認識されます。",
  },
];

export default async function Home() {
  const [user, priceLabel] = await Promise.all([
    getUser(),
    fetchPriceLabel(),
  ]);
  const isLoggedIn = Boolean(user);

  return (
    <>
      <SiteHeader isLoggedIn={isLoggedIn} />

      <main className="flex-1">
        {/* ヒーロー */}
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(62rem_32rem_at_68%_-18%,var(--brand-muted),transparent_70%)]"
          />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div>
              <p className="inline-flex animate-in items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1 text-xs font-medium text-brand fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
                <MapPin className="size-3.5" aria-hidden="true" />
                ローカル店舗向け・Googleマップのレビュー運用
              </p>

              <h1 className="mt-6 animate-in text-4xl font-bold tracking-tight text-balance fade-in-0 slide-in-from-bottom-2 duration-700 delay-100 motion-reduce:animate-none sm:text-5xl">
                Googleマップの
                <br />
                口コミにAIが返信。
              </h1>

              <p className="mt-6 max-w-xl animate-in text-lg leading-relaxed text-foreground/90 fade-in-0 slide-in-from-bottom-2 duration-700 delay-200 motion-reduce:animate-none">
                1時間ごとにレビューを取得し、点数に応じて返事を書き分けて投稿します。
              </p>
              <p className="mt-3 max-w-xl animate-in text-sm leading-relaxed text-muted-foreground fade-in-0 slide-in-from-bottom-2 duration-700 delay-250 motion-reduce:animate-none">
                低評価には誠実に謝罪と改善案を、高評価には店舗の強みを自然に。謝罪文にSEOキーワードを押しつけることはありません。
              </p>

              <div className="mt-8 flex animate-in flex-col gap-3 fade-in-0 slide-in-from-bottom-2 duration-700 delay-300 motion-reduce:animate-none sm:flex-row">
                <Button
                  size="lg"
                  className="h-11 bg-brand px-5 text-brand-foreground hover:bg-brand/90"
                  nativeButton={false}
                  render={<Link href="/signup" />}
                >
                  無料で始める
                  <ArrowRight data-icon="inline-end" />
                </Button>
                {!isLoggedIn && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 px-5"
                    nativeButton={false}
                    render={<Link href="/login" />}
                  >
                    ログイン
                  </Button>
                )}
              </div>
              <p className="mt-4 animate-in text-xs text-muted-foreground fade-in-0 duration-700 delay-350 motion-reduce:animate-none">
                月額1プラン。Googleマップとの連携は数分で完了します。
              </p>
            </div>

            <div className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 delay-200 motion-reduce:animate-none">
              <ReviewProof
                review={{
                  rating: 2,
                  reviewer: "T. 様",
                  publishedAt: "2026年10月18日",
                  body: "席に案内されるまで30分以上待ちました。料理は美味しかったのでまた来たいのですが、待ち時間の説明がありませんでした。",
                  replyLabel: "AIが作成した返信",
                  reply:
                    "この度はご来店いただき、誠に申し訳ございません。当日は想定を超えるご来店が重なったため、待ち時間のご連絡ができず、結果的にお待たせしてしまいました。今後はお席の確保の可否と待ち時間をお断りめにお伝えする運用へ改め、あわせて厨房の作業手順を整理し、お待ちいただく時間の短縮に努めてまいります。ご指摘をいただき、誠にありがとうございました。",
                }}
              />
            </div>
          </div>
        </section>

        {/* 仕様ストリップ */}
        <section className="border-b bg-muted/40">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
              <p className="text-sm">
                <span className="block font-medium">1時間ごとに自動取得</span>
                <span className="text-muted-foreground">
                  手動で取得することもできます
                </span>
              </p>
            </div>
            <div className="flex items-start gap-3">
              <ScanSearch className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
              <p className="text-sm">
                <span className="block font-medium">1店舗につき最新200件</span>
                <span className="text-muted-foreground">
                  未返信のレビューをまとめて一覧表示
                </span>
              </p>
            </div>
            <div className="flex items-start gap-3">
              <WandSparkles className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
              <p className="text-sm">
                <span className="block font-medium">点数で書き分けて生成</span>
                <span className="text-muted-foreground">
                  低評価と高評価で返事の型が変わる
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* 返信が書けない理由 */}
        <section id="why" className="scroll-mt-20 border-b">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <div>
              <p className="text-sm font-medium text-brand">こんな状態ではありませんか</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                返信は書きたい。でも、書けない。
              </h2>
              <p className="mt-5 leading-relaxed text-muted-foreground">
                Googleマップに届いたレビューは、そのまま放置されがちです。返信は後回しになりがちです。AIが代わりに文章を用意します。
              </p>
            </div>

            <ol className="divide-y divide-border border-y">
              {reasons.map((reason, index) => (
                <li key={reason.title} className="flex gap-5 py-6">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-brand/40">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-medium">{reason.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {reason.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 点数で書き分け */}
        <section id="feature" className="scroll-mt-20 border-b bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-sm font-medium text-brand">レビュー返信AIの中身</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              点数で、返事の書き方が変わる。
            </h2>
            <p className="mt-5 max-w-2xl leading-relaxed text-muted-foreground">
              同じAIでも、2点のレビューと5点のレビューでは、書くべき言葉がまったく違います。レビュー返信AIは評価で処理を分けます。
            </p>

            <div className="mt-12 grid gap-8 lg:grid-cols-2">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
                    1〜3点・低評価
                  </span>
                </div>
                <ul className="mt-5 space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="text-brand" aria-hidden="true">
                      ・
                    </span>
                    誠実に謝罪し、今後の改善方針を具体的に示します
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand" aria-hidden="true">
                      ・
                    </span>
                    SEOキーワードは一切入れません
                  </li>
                </ul>
                <ReviewProof
                  className="mt-6"
                  review={{
                    rating: 2,
                    reviewer: "T. 様",
                    publishedAt: "2026年10月18日",
                    body: "席に案内されるまで30分以上待ちました。料理は美味しかったのでまた来たいのですが、待ち時間の説明がありませんでした。",
                    replyLabel: "AIが作成した返信",
                    reply:
                      "この度はご来店いただき、誠に申し訳ございません。当日は想定を超えるご来店が重なったため、待ち時間のご連絡ができず、結果的にお待たせしてしまいました。今後はお席の確保の可否と待ち時間をお断りめにお伝えする運用へ改め、あわせて厨房の作業手順を整理し、お待ちいただく時間の短縮に努めてまいります。ご指摘をいただき、誠にありがとうございました。",
                  }}
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
                    4〜5点・高評価
                  </span>
                </div>
                <ul className="mt-5 space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="text-brand" aria-hidden="true">
                      ・
                    </span>
                    感謝を伝えつつ、店舗の強みを自然に盛り込みます
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand" aria-hidden="true">
                      ・
                    </span>
                    キーワードは並べるのではなく、文中に入り込みます
                  </li>
                </ul>
                <ReviewProof
                  className="mt-6"
                  review={{
                    rating: 5,
                    reviewer: "K. 様",
                    publishedAt: "2026年10月12日",
                    body: "新宿から徒歩3分。焼き肉が美味しくて、スタッフも丁寧でした。個室でゆっくり過ごせました。また来ます。",
                    replyLabel: "AIが作成した返信",
                    keywords: ["新宿", "焼き肉", "個室"],
                    reply:
                      "ご来店いただき、誠にありがとうございます。新宿駅徒歩3分の立地と、焼き肉を囲んでゆっくりお過ごしいただける個室をご用意しており、ご満足いただけたことを嬉しく思います。またのお越しをお待ちしております。",
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 使い方 */}
        <section id="howto" className="scroll-mt-20 border-b">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-sm font-medium text-brand">はじめかた</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              導入は3ステップ。
            </h2>

            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className="font-mono text-sm font-semibold tabular-nums text-brand">
                    STEP {index + 1}
                  </span>
                  <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 自動投稿の安全性 */}
        <section className="border-b bg-muted/40">
          <div className="mx-auto grid w-full max-w-6xl items-start gap-8 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                自動投稿は、初期値OFF
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                公開前に、確認する時間を残す。
              </h2>
              <p className="mt-5 leading-relaxed text-muted-foreground">
                自動返信スイッチは最初からOFFです。OFFのままでも、レビューを1件ずつ確認しながら「AI返信を作成して投稿」で公開できます。ONにすると取得したレビューには自動で投稿され、履歴では「AIが自動で作成した返信」と区別して記録されます。
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 ring-1 ring-foreground/5">
              <p className="text-sm font-medium">どちらの場合も</p>
              <ul className="mt-4 space-y-4 text-sm">
                <li className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  投稿される文は、<strong className="font-medium">店舗名義の公開レビュー</strong>
                  としてGoogleマップに表示されます。
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  手動で投稿したものと自動投稿したものは、履歴で区別できます。
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  返信文に店舗名やキーワードが自動で差し込まれることはありません。
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 料金 */}
        <section id="pricing" className="scroll-mt-20 border-b">
          <div className="mx-auto grid w-full max-w-6xl items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div>
              <p className="text-sm font-medium text-brand">料金</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                月額、1プランのみ。
              </h2>
              <p className="mt-5 text-4xl font-bold tracking-tight">
                {priceLabel ?? "月額"}
                {priceLabel && (
                  <span className="ml-2 text-base font-normal text-muted-foreground">
                    / 月（税込）
                  </span>
                )}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                連携・取得・生成・投稿のすべてが含まれます。追加費用はありません。解約はダッシュボードからいつでも行えます。
              </p>
              <Button
                className="mt-7 h-11 bg-brand px-5 text-brand-foreground hover:bg-brand/90"
                nativeButton={false}
                render={<Link href="/signup" />}
              >
                月額プランを契約する
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {features.map((feature) => (
                <li
                  key={feature}
                  className="flex gap-3 rounded-xl border border-border bg-card p-4 text-sm"
                >
                  <span
                    className="mt-0.5 size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* よくある質問 */}
        <section id="faq" className="scroll-mt-20 border-b bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-sm font-medium text-brand">よくある質問</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              料金や条件について
            </h2>
            <div className="mt-10">
              <Faq items={faqItems} />
            </div>
          </div>
        </section>

        {/* 最終CTA */}
        <section className="bg-brand text-brand-foreground">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-4 py-20 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                レビューに、返事を。
              </h2>
              <p className="mt-4 max-w-xl leading-relaxed text-brand-foreground/85">
                Googleマップのレビューに、AIが返信する。これから始める店舗も、1日1度だけ確認すれば済みます。
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-11 bg-brand-foreground px-5 text-brand hover:bg-brand-foreground/90"
                nativeButton={false}
                render={<Link href="/signup" />}
              >
                無料で始める
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 border-brand-foreground/40 bg-transparent px-5 text-brand-foreground hover:bg-brand-foreground/10 hover:text-brand-foreground"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                ログイン
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-foreground">
              <MapPin className="size-4" aria-hidden="true" />
            </span>
            レビュー返信AI
          </div>
          <nav aria-label="フッターナビゲーション" className="flex items-center gap-5 text-sm">
            <Link href="/signup" className="text-muted-foreground transition-colors hover:text-foreground">
              新規登録
            </Link>
            <Link href="/login" className="text-muted-foreground transition-colors hover:text-foreground">
              ログイン
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">
            © 2026 レビュー返信AI
          </p>
        </div>
      </footer>
    </>
  );
}
