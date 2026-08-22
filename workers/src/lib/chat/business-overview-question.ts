/**
 * The single place that decides whether a user is asking "what does this company
 * actually do / how does it make money".
 *
 * This used to be a regex literal copy-pasted at six sites (the intent
 * classifier, the deterministic answerer, the Gemini fallback question profile,
 * the low-quality-answer classifier, the source gate and the response
 * finalizer), and the copies drifted: the two gate copies had learned the
 * colloquial 「なにで稼いでんの」 forms while the three classifiers that decide
 * *which answer gets built* had not. A paired benchmark run
 * (testbench/runs/2026-08-22-human-phrasing-canary-32.jsonl) made the drift
 * visible — the same filing that answers 「この会社は何で儲けている？」 with real
 * segments answered 「収益源を十分に特定できません」 to the colloquial phrasing.
 *
 * Adding a phrase here teaches every site at once. Site-specific breadth stays
 * at the site, OR'd on top of these helpers, so the extra reach is visible where
 * it applies instead of silently widening the shared vocabulary.
 */

/**
 * Noun / interrogative-noun phrasings that are business-overview questions on
 * their own, in any surrounding sentence. Casual particles (って, の？, んの？)
 * need no handling because these are substring tests.
 */
const BUSINESS_OVERVIEW_NOUN_PATTERN =
  /(何屋|なに屋|なんの企業|何の企業|なんの会社|何の会社|なんの商売|何の商売|どんな企業|どんな会社|どういう企業|どういう会社|どういう商売|何してる|なにしてる|何をしてる|なにをしてる|何をしている|なにをしている|何をやってる|なにをやってる|何をやっている|なにをやっている|事業内容|主な事業|主要事業|事業は|ビジネスモデル|収益源|収益の柱|稼ぎ方|儲け方)/;

const BUSINESS_OVERVIEW_ENGLISH_PATTERN = /(whatdoes.*companydo|whatcompany|whatbusiness|businessmodel)/;

/**
 * The 稼ぐ／儲ける family, gated on an instrument interrogative. 稼 on its own is
 * not a business-overview signal: 「ちゃんとキャッシュ稼げてる？」 is a cash-flow
 * question, and both the intent classifier and the deterministic answerer check
 * business overview *before* cash flow, so a bare 稼 here would steal it.
 *
 * The optional object list deliberately omits 現金 — see CASH_TOPIC_PATTERN
 * below, which is the general form of the same guard.
 */
const EARNS_BY_WHAT_PATTERN =
  /(?:何で|なんで|なにで|どうやって|どうやったら|どのように)(?:お金|かね|金|利益|収益|売上)?を?(?:稼|儲け)/;

/**
 * A question that is about cash generation is not turned into a business
 * overview by the 稼ぐ family alone: 「現金はどうやって稼いでる？」 asks about
 * operating cash flow, not about what the company sells. Explicit noun forms
 * still win — 「キャッシュフローも含めて、この会社は何屋なの？」 is still an
 * overview.
 *
 * Bare キャッシュ is deliberately not listed: the intent classifier's cash_flow
 * branch does not recognize it either, so vetoing here would drop
 * 「キャッシュを何で稼いでる？」 into unknown instead of handing it to cash flow.
 * This guard only vetoes phrasings that another intent actually claims.
 */
const CASH_TOPIC_PATTERN = /(営業cf|フリーcf|キャッシュフロー|現金|operatingcashflow|freecashflow|cashflow|cash flow)/;

/**
 * The wider net the answer-quality gates (source-gate, response-finalizer) have
 * always cast: bare 稼ぐ／儲かる forms with no instrument interrogative. Kept out
 * of isBusinessOverviewQuestion on purpose — those gates only decide how to
 * grade or repair an answer, while the classifiers decide which answer gets
 * built, and 「キャッシュ稼いでる？」 must not reach the business-overview builder.
 */
const LOOSE_EARNINGS_PHRASE_PATTERN = /(稼いでる|稼いでん|儲けている|儲けてる|何で儲|なにで儲)/;

function normalize(question: string): string {
  return question.replace(/\s+/g, "").toLowerCase();
}

/**
 * Accepts either a raw question or one already normalized by the caller —
 * normalization is whitespace stripping plus lowercasing, so it is idempotent.
 */
export function isBusinessOverviewQuestion(question: string): boolean {
  const normalized = normalize(question);
  if (BUSINESS_OVERVIEW_NOUN_PATTERN.test(normalized) || BUSINESS_OVERVIEW_ENGLISH_PATTERN.test(normalized)) {
    return true;
  }
  if (CASH_TOPIC_PATTERN.test(normalized)) {
    return false;
  }
  return EARNS_BY_WHAT_PATTERN.test(normalized);
}

export function isLooseEarningsPhrasing(question: string): boolean {
  return LOOSE_EARNINGS_PHRASE_PATTERN.test(normalize(question));
}
