import { html } from "../lib/response";
import type { RouteHandler } from "./types";

type LegalPage = {
  path: string;
  title: string;
  updatedAt: string;
  sections: Array<{
    title: string;
    body: string;
  }>;
};

const legalPages: LegalPage[] = [
  {
    path: "/legal/privacy",
    title: "Kabuyomi プライバシーポリシー",
    updatedAt: "2026-05-05",
    sections: [
      {
        title: "1. 収集する情報",
        body:
          "Kabuyomi は、アプリの機能提供、利用制限、credit 残高と購入復元、品質改善、障害調査のために、匿名の device key、検索履歴、保存銘柄、閲覧した企業・提出書類、チャット利用回数、credit 残高、アプリ内操作、エラーやパフォーマンスに関する最小限の診断情報を扱います。氏名、メールアドレス、証券口座情報、保有資産情報、銀行口座情報はアプリの利用に必要としません。"
      },
      {
        title: "2. OpenAI API 利用時に送信される情報",
        body:
          "AI チャットや引用文翻訳を利用する場合、入力した質問文、翻訳対象の引用文、対象企業の SEC 提出資料メタデータ、抽出済みの MD&A、抽出済みの XBRL 指標、根拠として使う資料断片を OpenAI API などの外部 AI サービスに送信することがあります。OpenAI API に送信した内容は、OpenAI の法人・開発者向け条件に基づきサービス提供、不正利用防止、法令遵守等のために処理されます。個人情報、証券口座情報、未公開情報、第三者の機密情報は入力しないでください。"
      },
      {
        title: "3. 第三者サービス",
        body:
          "Kabuyomi は、API 配信、キャッシュ、利用制限管理に Cloudflare、米国企業の 10-K / 10-Q 取得に SEC EDGAR、AI 応答や翻訳に OpenAI API などの外部 AI サービス、広告表示や広告報酬の検証に Google AdMob、アプリ内課金と購入復元に Apple App Store / StoreKit を利用します。これらのサービスは、それぞれの規約およびプライバシーポリシーに基づいて情報を処理する場合があります。"
      },
      {
        title: "4. 広告",
        body:
          "無料プランでは Google AdMob による広告を表示する場合があります。任意の広告視聴による ad credit は、サーバー側で Google AdMob の完了確認ができた場合のみ反映されます。広告配信のため、Google AdMob SDK が広告識別子、デバイス情報、利用状況、診断情報などを扱うことがあります。Kabuyomi はアプリ内で株式売買を促す広告や、会話本文を妨げるインタースティシャル広告を前提にしていません。"
      },
      {
        title: "5. 利用目的",
        body:
          "収集した情報は、アプリ機能の提供、AI 応答と引用文翻訳、credit 残高と購入状態の管理、不正利用や二重消費の防止、障害調査、品質改善、広告表示、App Store の購入検証・復元、サポート対応のために使用します。"
      },
      {
        title: "6. 保存と削除",
        body:
          "端末内の保存銘柄、取得済み資料、チャット履歴は、設定画面のデータリセットにより削除できます。サーバー側では、利用制限、credit 台帳、購入重複防止、運用監査、障害調査に必要な最小限の記録を保持します。SEC 提出資料や抽出済みデータはキャッシュとして再利用されることがあります。サポート窓口に連絡いただいた場合、本人確認と運用上可能な範囲で削除や確認に対応します。"
      },
      {
        title: "7. 国外処理",
        body:
          "Kabuyomi が利用する Cloudflare、OpenAI、Google、Apple などの第三者サービスでは、日本国外を含む地域でデータが処理・保存される場合があります。"
      },
      {
        title: "8. 投資助言ではありません",
        body:
          "Kabuyomi は SEC 提出資料を読むためのリサーチ支援アプリです。株式の売買推奨、価格予測、証券口座連携、投資助言、利益保証は提供しません。投資判断は利用者自身の責任で行ってください。"
      },
      {
        title: "9. お問い合わせ",
        body:
          "プライバシーに関する問い合わせは、kabuyomi.support@gmail.com または X（Twitter）@0xt4dano までご連絡ください。"
      }
    ]
  },
  {
    path: "/legal/terms",
    title: "Kabuyomi 利用条件",
    updatedAt: "2026-05-05",
    sections: [
      {
        title: "1. サービスの性質",
        body:
          "Kabuyomi は SEC EDGAR の公開 10-K / 10-Q を日本語で読みやすくし、根拠付きの要約、指標表示、AI チャット、引用文翻訳を提供する SEC filing reader です。投資助言、売買推奨、株価予測、目標株価、証券口座連携、利益保証は提供しません。"
      },
      {
        title: "2. 利用の前提",
        body:
          "要約、AI チャット、翻訳、指標抽出には誤り、欠落、遅延、解釈の違いが含まれる可能性があります。回答はアプリが利用できる SEC 提出資料に基づきます。重要な判断を行う場合は、必ず SEC 原文、企業の公式資料、必要に応じて資格を持つ専門家の助言を確認してください。投資判断は利用者自身の責任で行ってください。"
      },
      {
        title: "3. 禁止事項",
        body:
          "個人情報、証券口座情報、未公開情報、第三者の機密情報を入力しないでください。不正利用、制限回避、過剰アクセス、サービス妨害を目的とした利用は禁止します。"
      },
      {
        title: "4. 免責",
        body:
          "Kabuyomi の情報を用いた投資判断は利用者自身の責任で行ってください。アプリの不具合、停止、表示内容の誤りによって生じた損失について、補償を前提としていません。"
      },
      {
        title: "5. App Store の標準 EULA",
        body:
          "Kabuyomi の利用には、Apple の Licensed Application End User License Agreement（Standard EULA）が適用されます。Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
      },
      {
        title: "6. credit購入について",
        body:
          "v1.0.2 では、買い切りの追加 paid credit と月額 subscription credit を App Store のアプリ内課金として提供します。kabuyomi.credits.50 は 50 paid credits を ¥100 で付与します。kabuyomi.credits.100 は既存の互換商品として、App Store で利用可能な場合に引き続き対応します。subscription group は Kabuyomi_sus です。Lite は ¥640/月で 400 credits/月、Pro は ¥1,280/月で 900 credits/月、Max は ¥2,560/月で 2,000 credits/月を付与します。paid credit は失効しません。subscription credit、free/promotional credit、ad credit、paid credit は分けて管理されます。購入、返金、請求、購入履歴、購入復元は Apple ID と App Store の仕組みおよび適用法に従います。"
      },
      {
        title: "7. 外部サービス",
        body:
          "Kabuyomi は Cloudflare、SEC EDGAR、OpenAI API、Google AdMob、Apple StoreKit などの外部サービスを利用します。外部サービスの停止、仕様変更、制限、障害により、Kabuyomi の一部機能が利用できない場合があります。"
      },
      {
        title: "8. お問い合わせ",
        body: "問い合わせは kabuyomi.support@gmail.com または X（Twitter）@0xt4dano までご連絡ください。"
      }
    ]
  },
  {
    path: "/legal/tokushoho",
    title: "Kabuyomi 特定商取引法に基づく表記",
    updatedAt: "2026-05-05",
    sections: [
      {
        title: "API-hosted fallback copy",
        body:
          "このページは API Worker 上の legacy fallback copy です。App Store metadata と公開法務リンクでは https://kabuyomi-legal-site.pages.dev/tokushoho/ を優先してください。"
      },
      {
        title: "事業者 / 販売者名",
        body:
          "プライバシー保護のため、販売者または運営者の氏名または名称はこのページ上では省略しています。特定商取引法に基づき開示請求があった場合、kabuyomi.support@gmail.com 宛ての請求に対して、メールその他の適切な方法により遅滞なく開示します。"
      },
      {
        title: "所在地",
        body:
          "プライバシー保護のため、所在地はこのページ上では省略しています。特定商取引法に基づき開示請求があった場合、kabuyomi.support@gmail.com 宛ての請求に対して、メールその他の適切な方法により遅滞なく開示します。"
      },
      {
        title: "電話番号",
        body:
          "プライバシー保護のため、電話番号はこのページ上では省略しています。特定商取引法に基づき開示請求があった場合、kabuyomi.support@gmail.com 宛ての請求に対して、メールその他の適切な方法により遅滞なく開示します。"
      },
      {
        title: "連絡先",
        body: "kabuyomi.support@gmail.com または X（Twitter）@0xt4dano までご連絡ください。"
      },
      {
        title: "販売価格",
        body: "v1.0.2 の主な paid credit 商品は kabuyomi.credits.50 です。販売価格は ¥100、付与数は 50 paid credits です。kabuyomi.credits.100 は既存の互換商品として、App Store で利用可能な場合に引き続き対応します。subscription group は Kabuyomi_sus です。Lite は ¥640/月で 400 credits/月、Pro は ¥1,280/月で 900 credits/月、Max は ¥2,560/月で 2,000 credits/月です。App Store の表示価格と税・手数料の扱いは Apple の決済画面に従います。"
      },
      {
        title: "支払時期 / 支払方法",
        body: "購入時に Apple ID / App Store のアプリ内課金で支払います。決済処理、請求、領収書、購入履歴は Apple の仕組みに従います。"
      },
      {
        title: "サービス提供時期",
        body: "Apple transaction を Kabuyomi Worker が App Store Server API で確認できた後、paid credit がアプリ内残高に反映されます。重複 transaction は二重付与せず、反映済みとして扱います。"
      },
      {
        title: "キャンセル / 返金",
        body: "デジタルコンテンツの性質上、購入後のキャンセルは原則として App Store の仕組みと適用法に従います。返金は Apple App Store の返金手続きおよび適用法に基づいて処理されます。"
      },
      {
        title: "動作環境",
        body: "Kabuyomi iOS アプリ、インターネット接続、Apple App Store / StoreKit、Kabuyomi API、SEC EDGAR、Cloudflare、OpenAI API などの外部サービスが利用可能である必要があります。"
      },
      {
        title: "credit の有効期限",
        body: "paid credit は失効しません。subscription credit、free/promotional credit、ad credit、paid credit は分けて管理されます。ad credit は任意の広告視聴後、サーバー側の広告報酬確認が完了した場合のみ付与されます。v1.0.2 の広告報酬は1回あたり +2 ad credits、1日3回まで、最大 +6 ad credits/日で、期限がある場合はアプリ内表示または関連説明に従います。"
      },
      {
        title: "投資助言ではありません",
        body:
          "Kabuyomi は SEC 10-K / 10-Q の読解支援アプリです。投資助言、売買推奨、株価予測、目標株価、証券口座連携、ポートフォリオ管理は提供しません。回答はアプリが利用できる SEC 提出資料に基づきます。投資判断は利用者自身の責任で行ってください。"
      }
    ]
  },
  {
    path: "/legal/support",
    title: "Kabuyomi サポート",
    updatedAt: "2026-04-26",
    sections: [
      {
        title: "問い合わせ先",
        body: "不具合、改善要望、プライバシーに関する問い合わせは kabuyomi.support@gmail.com または X（Twitter）@0xt4dano へご連絡ください。"
      },
      {
        title: "報告時に含めてほしい内容",
        body:
          "対象企業、画面名、質問文、表示された出典、期待した結果、実際の結果、発生時刻をできるだけ具体的に記載してください。"
      }
    ]
  }
];

export const handleLegalRoute: RouteHandler = async ({ request, url }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const page = legalPages.find((candidate) => candidate.path === url.pathname);
  if (!page) {
    return null;
  }

  const body = renderLegalPage(page);
  return html(request.method === "HEAD" ? "" : body);
};

function renderLegalPage(page: LegalPage): string {
  const fallbackNotice = `
        <section class="fallback-notice">
          <h2>API-hosted fallback copy</h2>
          <p>このページは API Worker 上の legacy fallback copy です。App Store metadata と公開法務リンクでは、Cloudflare Pages の static legal site を優先してください。</p>
        </section>`;
  const sections = page.sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.body)}</p>
        </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8f2e9;
        --card: rgba(255, 252, 247, 0.88);
        --text: #2a2520;
        --muted: #796b5d;
        --line: rgba(126, 95, 63, 0.18);
        --accent: #9b5722;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
        background: radial-gradient(circle at top left, #fffaf2 0, var(--bg) 42%, #eee7dc 100%);
        color: var(--text);
        line-height: 1.75;
      }
      main {
        width: min(880px, calc(100% - 32px));
        margin: 0 auto;
        padding: 48px 0 56px;
      }
      article {
        background: var(--card);
        border: 1px solid rgba(255, 255, 255, 0.82);
        border-radius: 28px;
        box-shadow: 0 22px 60px rgba(58, 45, 30, 0.12);
        padding: clamp(24px, 5vw, 48px);
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(30px, 6vw, 44px);
        line-height: 1.2;
        letter-spacing: 0;
      }
      .updated {
        margin: 0 0 32px;
        color: var(--muted);
        font-size: 14px;
      }
      section {
        padding: 24px 0;
        border-top: 1px solid var(--line);
      }
      .fallback-notice {
        margin: 0 0 8px;
        padding: 16px;
        border: 1px solid rgba(155, 87, 34, 0.45);
        border-radius: 14px;
        background: rgba(246, 226, 204, 0.58);
      }
      h2 {
        margin: 0 0 10px;
        color: var(--accent);
        font-size: 20px;
        line-height: 1.35;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: var(--text);
        font-size: 16px;
      }
      a { color: var(--accent); }
      footer {
        margin-top: 28px;
        color: var(--muted);
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="updated">最終更新日: ${escapeHtml(page.updatedAt)}</p>
        ${fallbackNotice}
        ${sections}
        <footer>Kabuyomi / Contact: kabuyomi.support@gmail.com / X: @0xt4dano</footer>
      </article>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
