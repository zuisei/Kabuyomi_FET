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
    updatedAt: "2026-04-26",
    sections: [
      {
        title: "1. 収集する情報",
        body:
          "Kabuyomi は、アプリの機能提供、利用制限、購読状態の確認、品質改善のために、匿名の device key、検索履歴、保存銘柄、チャット利用回数、credit 残高、購読プラン、アプリ内操作、エラーやパフォーマンスに関する最小限の診断情報を扱います。氏名、メールアドレス、証券口座情報、保有資産情報、銀行口座情報はアプリの利用に必要としません。"
      },
      {
        title: "2. AI 利用時に送信される情報",
        body:
          "AI チャットや引用文翻訳を利用する場合、入力した質問文、翻訳対象の引用文、対象企業の SEC 提出資料メタデータ、抽出済みの MD&A、抽出済みの XBRL 指標、根拠として使う資料断片を外部 AI モデルに送信することがあります。個人情報、証券口座情報、未公開情報、第三者の機密情報は入力しないでください。"
      },
      {
        title: "3. 第三者サービス",
        body:
          "Kabuyomi は、API 配信と利用制限管理に Cloudflare、米国企業の開示資料取得に SEC EDGAR、AI 応答や翻訳に外部 AI モデル、無料プランの広告表示に Google AdMob を利用します。これらのサービスは、それぞれのプライバシーポリシーに基づいて情報を処理する場合があります。"
      },
      {
        title: "4. 広告",
        body:
          "無料プランでは Google AdMob によるバナー広告を表示する場合があります。広告配信のため、Google AdMob SDK が広告識別子、デバイス情報、利用状況、診断情報などを扱うことがあります。Kabuyomi はアプリ内で株式売買を促す広告や、会話本文を妨げるインタースティシャル広告を前提にしていません。"
      },
      {
        title: "5. 利用目的",
        body:
          "収集した情報は、アプリ機能の提供、credit や購読状態の管理、不正利用や二重消費の防止、障害調査、品質改善、広告表示、App Store の購入復元やサポート対応のために使用します。"
      },
      {
        title: "6. 保存と削除",
        body:
          "端末内の保存銘柄、取得済み資料、チャット履歴は、設定画面のデータリセットにより削除できます。サーバー側では、利用制限、credit 台帳、購読同期、購入重複防止、運用監査に必要な最小限の記録を保持します。サポート窓口に連絡いただいた場合、本人確認と運用上可能な範囲で削除や確認に対応します。"
      },
      {
        title: "7. 投資助言ではありません",
        body:
          "Kabuyomi は SEC 提出資料を読むためのリサーチ支援アプリです。株式の売買推奨、価格予測、証券口座連携、投資助言、利益保証は提供しません。投資判断は利用者自身の責任で行ってください。"
      },
      {
        title: "8. お問い合わせ",
        body:
          "プライバシーに関する問い合わせは、kabuyomi.support@gmail.com または X（Twitter）@0xt4dano までご連絡ください。"
      }
    ]
  },
  {
    path: "/legal/terms",
    title: "Kabuyomi 利用条件",
    updatedAt: "2026-04-26",
    sections: [
      {
        title: "1. サービスの性質",
        body:
          "Kabuyomi は SEC EDGAR の公開提出書類を日本語で読みやすくするための情報提供アプリです。投資助言、売買推奨、株価予測、アナリスト予想比較は提供しません。"
      },
      {
        title: "2. 利用の前提",
        body:
          "要約や AI チャットには誤りや省略が含まれる可能性があります。重要な判断を行う場合は、必ず SEC 原文や公式資料を確認してください。"
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
        title: "5. お問い合わせ",
        body: "問い合わせは kabuyomi.support@gmail.com または X（Twitter）@0xt4dano までご連絡ください。"
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
