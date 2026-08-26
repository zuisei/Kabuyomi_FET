import { checkRegulationsGov, checkWhiteHouse, discoverFederalRegister, type DiscoveryEnv } from "./discovery.ts";
import { repairPendingStorage } from "./storage/repair.ts";
import { resolvedTimePrecision, type IngestTimePrecision } from "./processor/read-model.ts";
import { calculateReviewedMarketStudy, type ReviewedNormalizedPoint } from "./market/study.ts";
import {
  addCompanyRelationCandidate,
  analysisHistory,
  analysisPreview,
  createAnalysisDraft,
  replaceAnalysisDraft,
  reviewCompanyRelation,
  transitionAnalysis
} from "./editorial/admin.ts";
import {
  pollSubmittedBatches,
  prepareBatchManifest,
  processRealtimeTranslationForEvent,
  processRealtimeTranslations,
  queueTranslationCandidates,
  submitBatchManifest,
  translationOperationalStatus
} from "./translation/service.ts";

export interface Env extends DiscoveryEnv {
  CORE: D1Database;
  OPS: D1Database;
  RAW: R2Bucket;
  DERIVED: R2Bucket;
  TEMP: R2Bucket;
  ADMIN_TOKEN: string;
  ENVIRONMENT: string;
  REGULATIONS_GOV_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSLATION_MODEL?: string;
  TRANSLATION_REALTIME_CUTOFF?: string;
  TRANSLATION_REALTIME_LIMIT?: string;
  TRANSLATION_DAILY_TOKEN_BUDGET?: string;
  TRANSLATION_TRIGGER_TOKEN?: string;
}

type IngestRequest = {
  sourceCode: "BIS" | "WH" | "USTR" | "DOC" | "FR" | "GOVINFO";
  externalID: string;
  sourceURL: string;
  eventID: string;
  documentID: string;
  documentNumber: string;
  revisionNumber: number;
  documentType: "final_rule" | "correcting_amendment" | "notice" | "other";
  relationship: "primary" | "corrects" | "related";
  correctsDocumentID?: string;
  titleJA: string;
  titleEN: string;
  publisherJA: string;
  publisherEN: string;
  publishedOn: string;
  effectiveOn?: string;
  applicableOn?: string;
  commentsCloseOn?: string;
  sourceStatedAt?: string;
  sourceStatedTimezone?: string;
  availableAt: string;
  availabilityBasis: "source_stated" | "first_observed" | "publication_date_only" | "manual_estimate";
  timePrecision?: IngestTimePrecision;
  bodyText: string;
  rawBodyBase64?: string;
  contentType?: string;
  displayBodyJA: string;
  displayBodyEN: string;
  changeSummaryJA?: string;
  firstObservedAt?: string;
};

type CompletionRequest = {
  processorID: string;
  rawSHA256: string;
  normalizedSHA256: string;
  diffSHA256?: string;
  normalizedText: string;
  diff?: { deleted: string[]; added: string[] };
  eventReadModel: Record<string, unknown>;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const sha256Pattern = /^[0-9a-f]{64}$/;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function unauthorized(): Response {
  return json({ error: { code: "unauthorized", message: "A valid admin bearer token is required" } }, 401);
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return token.length > 0 && token === env.ADMIN_TOKEN;
}

async function isTranslationTriggerAuthorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.TRANSLATION_TRIGGER_TOKEN?.trim() ?? "";
  const presented = request.headers.get("x-md-translation-trigger")?.trim() ?? "";
  if (!expected || !presented) return false;
  const [expectedHash, presentedHash] = await Promise.all([sha256(expected), sha256(presented)]);
  return expectedHash === presentedHash;
}

function hasSafeMutationOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Service Auth / processor clients do not send browser Origin.
  return origin === new URL(request.url).origin;
}

function isUUID(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isISODate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateIngest(value: unknown): IngestRequest {
  if (!value || typeof value !== "object") throw new Error("JSON object is required");
  const request = value as Partial<IngestRequest>;
  const agencies = new Set(["BIS", "WH", "USTR", "DOC", "FR", "GOVINFO"]);
  if (!request.sourceCode || !agencies.has(request.sourceCode)) throw new Error("sourceCode is invalid");
  for (const field of ["externalID", "sourceURL", "documentNumber", "documentType", "relationship", "titleJA", "titleEN", "publisherJA", "publisherEN", "publishedOn", "availableAt", "availabilityBasis", "bodyText", "displayBodyJA", "displayBodyEN"] as const) {
    if (typeof request[field] !== "string" || request[field]!.trim().length === 0) throw new Error(`${field} is required`);
  }
  if (!isUUID(request.eventID) || !isUUID(request.documentID)) throw new Error("eventID and documentID must be UUIDs");
  if (request.correctsDocumentID && !isUUID(request.correctsDocumentID)) throw new Error("correctsDocumentID must be a UUID");
  if (request.relationship === "corrects" && !request.correctsDocumentID) throw new Error("correctsDocumentID is required for a correcting document");
  if (!new Set(["final_rule", "correcting_amendment", "notice", "other"]).has(request.documentType!)) throw new Error("documentType is invalid");
  if (!new Set(["primary", "corrects", "related"]).has(request.relationship!)) throw new Error("relationship is invalid");
  if (!new Set(["source_stated", "first_observed", "publication_date_only", "manual_estimate"]).has(request.availabilityBasis!)) throw new Error("availabilityBasis is invalid");
  if (request.timePrecision && !new Set(["exact", "minute", "hour", "day"]).has(request.timePrecision)) throw new Error("timePrecision is invalid");
  if (request.availabilityBasis === "publication_date_only" && request.timePrecision && request.timePrecision !== "day") throw new Error("publication_date_only requires day precision");
  if (!Number.isInteger(request.revisionNumber) || request.revisionNumber! < 1) throw new Error("revisionNumber must be a positive integer");
  if (!/^https:\/\//.test(request.sourceURL!)) throw new Error("sourceURL must use HTTPS");
  for (const field of ["publishedOn", "effectiveOn", "applicableOn", "commentsCloseOn"] as const) {
    if (request[field] && !/^\d{4}-\d{2}-\d{2}$/.test(request[field]!)) throw new Error(`${field} must be YYYY-MM-DD`);
  }
  if (!isISODate(request.availableAt)) throw new Error("availableAt must be an ISO-8601 timestamp");
  return request as IngestRequest;
}

function adminHTML(): Response {
  return new Response(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Market Docket 管理</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f}main{max-width:760px;margin:auto;padding:32px 20px 80px}h1{font-size:28px}section{background:white;border:1px solid #ddd;border-radius:16px;padding:20px;margin:16px 0}label{display:block;font-size:13px;color:#555;margin-top:13px}input,textarea,select,button{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #bbb;border-radius:9px}textarea{min-height:110px}button{margin-top:18px;background:#0071e3;color:white;border:0;font-weight:600}button.danger{background:#b42318}button:disabled{opacity:.45}pre{white-space:pre-wrap;background:#111;color:#eee;padding:14px;border-radius:10px;min-height:48px}.hint{font-size:13px;color:#666}.warning{padding:12px;border-radius:10px;background:#fff4e5;color:#7a4100;font-size:13px}
</style></head><body><main><h1>Market Docket 管理</h1><p>公式資料 → 自動分析 → 自動選定</p>
<section><h2>認証</h2><label>Admin token</label><input id="token" type="password" autocomplete="off"><p class="hint">ブラウザには保存しません。</p></section>
<section><h2>運用状況</h2><p class="hint">未処理job、失敗、重複Revision、公開待ち、関係候補、source health、R2台帳を確認します。</p><button id="statusButton" type="button">状態を読み込む</button><pre id="statusOutput">未取得</pre></section>
<section><h2>日本語翻訳</h2><p class="hint">2026年7月22日0時JST以降は即時、それ以前はBatch候補です。自動翻訳と政策分析は別管理です。</p>
<button id="translationStatusButton" type="button">翻訳状況を確認</button><button id="translationRealtimeButton" type="button">今日分を即時翻訳</button>
<button id="translationPrepareButton" type="button">過去分のBatch見積りを作成（送信しない）</button>
<pre id="translationOutput">未取得</pre>
<p class="warning">Batch送信は、上の見積りに表示された件数・推定token・最大課金額を確認し、完全一致する確認文を入力した場合だけ実行できます。</p>
<label>Batch確認文</label><input id="batchConfirmation" autocomplete="off" placeholder="見積り後に表示される確認文を入力"><button id="batchSubmitButton" class="danger" type="button" disabled>確認したBatchを送信</button></section>
<section><h2>文書を手動登録</h2><form id="form">
<label>Agency</label><select name="sourceCode"><option>BIS</option><option>WH</option><option>USTR</option><option>DOC</option><option>FR</option><option>GOVINFO</option></select>
<label>外部文書ID</label><input name="externalID" required><label>公式URL</label><input name="sourceURL" type="url" required>
<label>Event UUID</label><input name="eventID" required><label>Document UUID</label><input name="documentID" required>
<label>文書番号</label><input name="documentNumber" required><label>文書種別</label><select name="documentType"><option value="final_rule">Final rule</option><option value="correcting_amendment">Correcting amendment</option><option value="notice">Notice</option><option value="other">Other</option></select>
<label>イベントとの関係</label><select name="relationship"><option value="primary">原文書</option><option value="corrects">訂正文書</option><option value="related">関連文書</option></select><label>訂正対象 Document UUID</label><input name="correctsDocumentID">
<label>同一文書内のRevision</label><input name="revisionNumber" type="number" min="1" value="1" required>
<label>日本語タイトル</label><input name="titleJA" required><label>English title</label><input name="titleEN" required>
<label>公開元（日本語）</label><input name="publisherJA" required><label>Publisher (English)</label><input name="publisherEN" required>
<label>Federal Register掲載日</label><input name="publishedOn" type="date" required><label>発効日</label><input name="effectiveOn" type="date"><label>適用開始日</label><input name="applicableOn" type="date"><label>意見期限</label><input name="commentsCloseOn" type="date">
<label>資料記載時刻（原文のまま）</label><input name="sourceStatedAt"><label>資料記載タイムゾーン（確定時のみ）</label><input name="sourceStatedTimezone">
<label>Replay利用可能境界</label><input name="availableAt" required><label>境界の根拠</label><select name="availabilityBasis"><option value="publication_date_only">掲載日のみ判明</option><option value="source_stated">資料記載時刻</option><option value="first_observed">初回発見</option><option value="manual_estimate">手動推定</option></select><label>時刻精度</label><select name="timePrecision"><option value="day">日</option><option value="hour">時</option><option value="minute">分</option><option value="exact">秒まで</option></select>
<label>原文ファイル（任意・PDFまたはテキスト）</label><input id="file" type="file" accept="application/pdf,text/*,.pdf,.txt"><input name="rawBodyBase64" type="hidden"><input name="contentType" type="hidden"><label>抽出済み原文テキスト</label><textarea name="bodyText" required></textarea>
<label>表示用の日本語要約</label><textarea name="displayBodyJA" required></textarea><label>表示用原文抜粋</label><textarea name="displayBodyEN" required></textarea>
<label>変更要約（Revision 2以降）</label><textarea name="changeSummaryJA"></textarea><button>ジョブを作成</button></form></section>
<section><h2>政策分析ドラフト</h2><p class="hint">必要項目が揃ったSignal Draftは、未検証を明示して自動選定されます。下の編集判断は任意の履歴であり、自動選定の条件ではありません。</p><form id="analysisForm">
<label>Event UUID</label><input name="eventID" required><label>利用者向け日本語見出し</label><input name="canonicalTitleJA"><label>原文タイトル</label><input name="canonicalTitleEN">
<label>何が変わったか</label><textarea name="changeSummaryJA"></textarea><label>なぜ重要か</label><textarea name="whyItMattersJA"></textarea>
<label>政策種別</label><input name="policyType"><label>政策分野codes（カンマ区切り）</label><input name="policyDomainCodes"><label>主機関code</label><input name="primaryAgencyCode">
<label>地域codes（カンマ区切り）</label><input name="affectedRegionCodes"><label>業界codes（カンマ区切り）</label><input name="affectedSectorCodes"><label>製品語（カンマ区切り）</label><input name="affectedProductTerms">
<label>表示Tier</label><select name="presentationTier"><option value="signal">Signal</option><option value="monitor">Monitor</option><option value="archive">Archive</option></select>
<label>市場モード</label><select name="marketAnalysisMode"><option value="intraday">intraday</option><option value="daily">daily</option><option value="unmapped">unmapped</option><option value="not_applicable">not_applicable</option><option value="disabled">disabled</option></select>
<label>市場関連性の理由</label><textarea name="marketRelevanceReasonJA"></textarea><label>関連企業なしの理由</label><textarea name="noCompanyReasonJA"></textarea><label>市場データなしの理由</label><textarea name="noMarketDataReasonJA"></textarea>
<label>編集優先度（内部のみ）</label><input name="editorialPriority" type="number" value="0"><label>Draft generator</label><input name="generatedBy" value="automated-editorial-draft"><label>Note</label><textarea name="note"></textarea><button>自動分析ドラフトを作成</button></form>
<form id="analysisDecisionForm"><label>Analysis UUID</label><input name="analysisID" required><label>操作</label><select name="action"><option value="review">編集確認を記録</option><option value="publish">公開状態を記録</option><option value="reject">差し戻す</option></select><label>記録者</label><input name="reviewedBy" required><label>判断メモ</label><textarea name="note"></textarea><button>任意の編集判断を記録</button></form>
<form id="analysisInspectForm"><label>Event UUID</label><input name="eventID" required><button type="button" id="analysisPreviewButton">利用者画面プレビュー</button><button type="button" id="analysisHistoryButton">編集履歴</button></form></section>
<section><h2>Analyst Enrichedレビュー</h2><form id="enrichForm">
<label>Event UUID</label><input name="eventID" required><label>確認済み日本語要約</label><textarea name="summaryJA" required></textarea>
<label>政策分野slug</label><input name="domainSlug" required placeholder="trade-tariffs"><label>重要条項</label><textarea name="importantClauseJA" required></textarea>
<label>重要条項の公式URL</label><input name="clauseSourceURL" type="url" required><label>交絡要因レビュー</label><select name="confounderReviewState"><option value="verified_none">人間確認済み0件</option><option value="candidate">候補あり・未確認</option><option value="verified">確認済み要因あり</option></select>
<label>Reviewer</label><input name="reviewedBy" required><label>Note</label><textarea name="note"></textarea><button>人間レビューを確定</button></form></section>
<section><h2>交絡要因を追加</h2><form id="confounderForm">
<label>Event UUID</label><input name="eventID" required><label>見出し</label><input name="titleJA" required><label>詳細</label><textarea name="detailJA" required></textarea><label>関連性</label><input name="relevance" required>
<label>種別</label><select name="kind"><option value="macro">主要マクロ発表</option><option value="issuer_filing">8-K等</option><option value="earnings">決算</option><option value="analyst">アナリスト変更</option><option value="peer">同業他社</option><option value="market">市場全体</option><option value="geopolitical">地政学</option><option value="other">その他</option></select>
<label>根拠URL</label><input name="sourceURL" type="url" required><label>発生時刻</label><input name="occurredAt" required><label>判明時刻</label><input name="availableAt" required>
<label>レビュー状態</label><select name="reviewState"><option value="verified">人間確認済み</option><option value="candidate">候補・未確認</option></select><label>Reviewer</label><input name="reviewedBy" required><button>交絡要因を追加</button></form></section>
<section><h2>市場データ表示権のレビュー</h2><p class="hint">契約・プランが利用者向け表示を許可することを、根拠メモとともに人間が確認します。</p><form id="providerForm">
<label>Provider ID</label><input name="providerID" required placeholder="twelve-data-byok"><label>判定</label><select name="decision"><option value="approved">表示権を確認済み</option><option value="rejected">表示不可</option></select>
<label>権利確認メモ</label><textarea name="rightsNote" required></textarea><label>Reviewer</label><input name="reviewedBy" required><button>表示権レビューを記録</button></form></section>
<section><h2>証拠付き市場マッピング</h2><p class="hint">Analyst Enrichedと交絡要因確認の完了後、正規化系列を再計算して確定します。値動きと政策の因果関係は未確定です。</p><form id="marketForm">
<label>Event UUID</label><input name="eventID" required><label>Ticker</label><input name="ticker" required><label>Exchange</label><input name="exchange" required><label>会社・銘柄名</label><input name="companyName" required>
<label>関係</label><select name="relationship"><option value="direct">直接</option><option value="indirect">間接</option><option value="supplier">供給</option><option value="customer">顧客</option><option value="competitor">競合</option><option value="sector_proxy">セクター代理</option><option value="benchmark">ベンチマーク</option></select><label>確信度 (0–1)</label><input name="confidence" type="number" min="0" max="1" step="0.01" required>
<label>根拠 Document UUID</label><input name="evidenceDocumentID" required><label>根拠条項</label><textarea name="evidenceClause" required></textarea><label>根拠URL</label><input name="evidenceURL" type="url" required>
<label>Benchmark ticker</label><input name="benchmarkTicker" required value="SPY"><label>Provider ID</label><input name="providerID" required><label>評価窓</label><select name="windowName"><option value="fiveMinutes">公式公開後5分</option><option value="thirtyMinutes">公式公開後30分</option><option value="twoHours">公式公開後2時間</option><option value="sameDayClose">当日終値</option><option value="nextDayClose">翌日終値</option><option value="fiveTradingDays">5営業日後</option><option value="nextRegularSessionOpen">次回Regular Session寄付</option><option value="fiveMinutesAfterOpen">寄付後5分</option><option value="thirtyMinutesAfterOpen">寄付後30分</option><option value="twoHoursAfterOpen">寄付後2時間</option><option value="previousCloseToOpen">前営業日終値→当日始値</option><option value="previousCloseToClose">前営業日終値→当日終値</option><option value="closeToNextClose">当日終値→翌日終値</option><option value="fiveTradingDayReturn">5営業日リターン</option><option value="thirtyMinutesFromDetection">システム検知後30分</option></select>
<label>窓の開始（ISO-8601）</label><input name="windowStart" required><label>窓の終了（ISO-8601）</label><input name="windowEnd" required><label>時刻精度</label><select name="timePrecision"><option value="exact">秒まで</option><option value="minute">分</option><option value="hour">時</option><option value="day">日</option></select>
<label>評価完了時刻（ISO-8601）</label><input name="evaluatedAt" required><label>Replay利用可能時刻（ISO-8601）</label><input name="availableAt" required>
<label>正規化系列</label><textarea name="pointLines" required placeholder="2026-07-21T14:30:00Z, 100, 100, 1&#10;2026-07-21T15:00:00Z, 101.2, 100.4, 1.8"></textarea><p class="hint">1行ごとに「時刻, 対象価格指数, ベンチマーク価格指数, 出来高倍率」。</p>
<label>Reviewer</label><input name="reviewedBy" required><button>市場評価を再計算して確定</button></form></section>
<section><h2>文書関係候補レビュー</h2><form id="relationshipForm">
<label>Relationship UUID</label><input name="relationshipID" required><label>判定</label><select name="decision"><option value="approved">承認</option><option value="rejected">却下</option></select><label>Reviewer</label><input name="reviewedBy" required><label>Note</label><textarea name="note"></textarea><button>関係候補をレビュー</button></form></section>
<section><h2>処理結果</h2><pre id="output">待機中</pre></section>
<script>
const form=document.querySelector('#form'),out=document.querySelector('#output'),file=document.querySelector('#file'),statusButton=document.querySelector('#statusButton'),statusOutput=document.querySelector('#statusOutput'),translationOutput=document.querySelector('#translationOutput');
const tokenHeader=()=>({'content-type':'application/json','authorization':'Bearer '+document.querySelector('#token').value});
const adminJSON=async(path,options={})=>{const r=await fetch(path,{...options,headers:{...tokenHeader(),...(options.headers||{})}});const body=await r.json();if(!r.ok)throw new Error(JSON.stringify(body));return body};
const submitReview=async(form,path)=>{out.textContent='送信中…';const data=Object.fromEntries(new FormData(form));const r=await fetch(path(data),{method:'POST',headers:tokenHeader(),body:JSON.stringify(data)});out.textContent=JSON.stringify(await r.json(),null,2)};
statusButton.addEventListener('click',async()=>{statusOutput.textContent='取得中…';try{const r=await fetch('/admin/status',{headers:{'authorization':'Bearer '+document.querySelector('#token').value}});statusOutput.textContent=JSON.stringify(await r.json(),null,2)}catch(error){statusOutput.textContent=String(error)}});
let preparedBatch=null;
document.querySelector('#translationStatusButton').addEventListener('click',async()=>{translationOutput.textContent='取得中…';try{translationOutput.textContent=JSON.stringify(await adminJSON('/admin/translations/status'),null,2)}catch(error){translationOutput.textContent=String(error)}});
document.querySelector('#translationRealtimeButton').addEventListener('click',async()=>{translationOutput.textContent='今日分を翻訳中…';try{translationOutput.textContent=JSON.stringify(await adminJSON('/admin/translations/realtime/run',{method:'POST',body:'{}'}),null,2)}catch(error){translationOutput.textContent=String(error)}});
document.querySelector('#translationPrepareButton').addEventListener('click',async()=>{translationOutput.textContent='見積り作成中…';try{preparedBatch=await adminJSON('/admin/translations/batch/prepare',{method:'POST',body:JSON.stringify({maximumItems:500})});translationOutput.textContent=JSON.stringify(preparedBatch,null,2);document.querySelector('#batchConfirmation').value='';document.querySelector('#batchConfirmation').placeholder=preparedBatch.requiredConfirmation;document.querySelector('#batchSubmitButton').disabled=false}catch(error){translationOutput.textContent=String(error)}});
document.querySelector('#batchSubmitButton').addEventListener('click',async()=>{if(!preparedBatch)return;const confirmation=document.querySelector('#batchConfirmation').value.trim();if(confirmation!==preparedBatch.requiredConfirmation){translationOutput.textContent='確認文が完全一致しないため送信しません。';return}if(!window.confirm('過去資料 '+preparedBatch.candidateCount+'件、推定 '+preparedBatch.estimatedTotalTokens+' token、最大 $'+preparedBatch.estimatedMaxCostUSD+' をOpenAI Batchへ送信します。続行しますか？'))return;translationOutput.textContent='Batch送信中…';try{translationOutput.textContent=JSON.stringify(await adminJSON('/admin/translations/batch/'+encodeURIComponent(preparedBatch.manifestID)+'/submit',{method:'POST',body:JSON.stringify({confirmation})}),null,2);document.querySelector('#batchSubmitButton').disabled=true}catch(error){translationOutput.textContent=String(error)}});
file.addEventListener('change',async()=>{const f=file.files[0];if(!f)return;form.contentType.value=f.type||'application/octet-stream';const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));form.rawBodyBase64.value=btoa(binary);if(f.type.startsWith('text/'))form.bodyText.value=new TextDecoder().decode(bytes)});
form.addEventListener('submit',async e=>{e.preventDefault();out.textContent='送信中…';const data=Object.fromEntries(new FormData(form));data.revisionNumber=Number(data.revisionNumber);try{const r=await fetch('/admin/ingests',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+document.querySelector('#token').value},body:JSON.stringify(data)});out.textContent=JSON.stringify(await r.json(),null,2)}catch(error){out.textContent=String(error)}});
document.querySelector('#enrichForm').addEventListener('submit',async e=>{e.preventDefault();try{await submitReview(e.currentTarget,data=>'/admin/events/'+encodeURIComponent(data.eventID)+'/enrich')}catch(error){out.textContent=String(error)}});
document.querySelector('#confounderForm').addEventListener('submit',async e=>{e.preventDefault();try{await submitReview(e.currentTarget,data=>'/admin/events/'+encodeURIComponent(data.eventID)+'/confounders')}catch(error){out.textContent=String(error)}});
document.querySelector('#providerForm').addEventListener('submit',async e=>{e.preventDefault();try{await submitReview(e.currentTarget,data=>'/admin/market-providers/'+encodeURIComponent(data.providerID)+'/review')}catch(error){out.textContent=String(error)}});
document.querySelector('#marketForm').addEventListener('submit',async e=>{e.preventDefault();out.textContent='送信中…';try{const data=Object.fromEntries(new FormData(e.currentTarget));data.confidence=Number(data.confidence);data.points=String(data.pointLines).trim().split(/\n+/).map(line=>{const values=line.split(',').map(value=>value.trim());return {timestamp:values[0],normalizedSecurityPrice:Number(values[1]),normalizedBenchmarkPrice:Number(values[2]),volumeRatio:Number(values[3])}});delete data.pointLines;const r=await fetch('/admin/events/'+encodeURIComponent(data.eventID)+'/market-mappings',{method:'POST',headers:tokenHeader(),body:JSON.stringify(data)});out.textContent=JSON.stringify(await r.json(),null,2)}catch(error){out.textContent=String(error)}});
document.querySelector('#relationshipForm').addEventListener('submit',async e=>{e.preventDefault();try{await submitReview(e.currentTarget,data=>'/admin/relationships/'+encodeURIComponent(data.relationshipID)+'/review')}catch(error){out.textContent=String(error)}});
const csv=value=>String(value||'').split(',').map(item=>item.trim()).filter(Boolean);
document.querySelector('#analysisForm').addEventListener('submit',async e=>{e.preventDefault();out.textContent='送信中…';try{const data=Object.fromEntries(new FormData(e.currentTarget));for(const key of ['policyDomainCodes','affectedRegionCodes','affectedSectorCodes','affectedProductTerms'])data[key]=csv(data[key]);data.editorialPriority=Number(data.editorialPriority||0);const eventID=data.eventID;delete data.eventID;const r=await fetch('/admin/events/'+encodeURIComponent(eventID)+'/analysis-drafts',{method:'POST',headers:tokenHeader(),body:JSON.stringify(data)});out.textContent=JSON.stringify(await r.json(),null,2)}catch(error){out.textContent=String(error)}});
document.querySelector('#analysisDecisionForm').addEventListener('submit',async e=>{e.preventDefault();try{await submitReview(e.currentTarget,data=>'/admin/analyses/'+encodeURIComponent(data.analysisID)+'/transition')}catch(error){out.textContent=String(error)}});
const inspect=async suffix=>{out.textContent='取得中…';const eventID=new FormData(document.querySelector('#analysisInspectForm')).get('eventID');const r=await fetch('/admin/events/'+encodeURIComponent(eventID)+'/'+suffix,{headers:{'authorization':'Bearer '+document.querySelector('#token').value}});out.textContent=JSON.stringify(await r.json(),null,2)};
document.querySelector('#analysisPreviewButton').addEventListener('click',()=>inspect('analysis-preview'));
document.querySelector('#analysisHistoryButton').addEventListener('click',()=>inspect('analysis-history'));
</script></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

async function createIngest(request: Request, env: Env): Promise<Response> {
  let input: IngestRequest;
  try { input = validateIngest(await request.json()); }
  catch (error) { return json({ error: { code: "invalid_ingest", message: String(error) } }, 400); }

  const now = new Date().toISOString();
  const runID = crypto.randomUUID();
  const jobID = crypto.randomUUID();
  const objectKey = `v1/runs/${runID}/jobs/${jobID}/input.json`;
  const idempotencyKey = `document-v2:${input.sourceCode}:${input.externalID}:${input.documentID}:r${input.revisionNumber}`;
  input = { ...input, firstObservedAt: now };
  await env.TEMP.put(objectKey, JSON.stringify(input), { httpMetadata: { contentType: "application/json" }, customMetadata: { runID, jobID } });
  try {
    await env.OPS.batch([
      env.OPS.prepare("INSERT INTO ingestion_runs (id, trigger_kind, status, started_at) VALUES (?, 'manual', 'running', ?)").bind(runID, now),
      env.OPS.prepare("INSERT INTO jobs (id, run_id, job_kind, status, attempt_count, available_at, next_attempt_at, created_at, idempotency_key, payload_json) VALUES (?, ?, 'process_document', 'queued', 0, ?, ?, ?, ?, ?)").bind(jobID, runID, now, now, now, idempotencyKey, JSON.stringify({ objectKey, eventID: input.eventID, documentID: input.documentID, revisionNumber: input.revisionNumber }))
    ]);
  } catch (error) {
    await env.TEMP.delete(objectKey);
    const duplicate = await env.OPS.prepare("SELECT id, status FROM jobs WHERE idempotency_key = ?").bind(idempotencyKey).first<{ id: string; status: string }>();
    if (duplicate) return json({ duplicate: true, job: duplicate }, 200);
    return json({ error: { code: "job_create_failed", message: String(error) } }, 500);
  }
  return json({ runID, jobID, status: "queued", tempObjectKey: objectKey }, 201);
}

async function claimJob(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { processorID?: string; leaseSeconds?: number };
  if (!body.processorID || body.processorID.length > 120) return json({ error: { code: "invalid_processor", message: "processorID is required" } }, 400);
  const leaseSeconds = Math.max(30, Math.min(900, Math.floor(body.leaseSeconds ?? 300)));
  const now = new Date();
  const nowISO = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = await env.OPS.prepare(`SELECT id, run_id, payload_json FROM jobs
      WHERE ((status IN ('queued','retry') AND COALESCE(next_attempt_at, available_at) <= ?)
        OR (status = 'processing' AND lease_expires_at <= ?))
      ORDER BY COALESCE(next_attempt_at, available_at), created_at LIMIT 1`).bind(nowISO, nowISO).first<{ id: string; run_id: string; payload_json: string }>();
    if (!candidate) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    const claimed = await env.OPS.prepare(`UPDATE jobs SET status='processing', attempt_count=attempt_count+1,
      claimed_by=?, lease_expires_at=?, locked_by=?, locked_at=? WHERE id=? AND
      (((status IN ('queued','retry')) AND COALESCE(next_attempt_at, available_at) <= ?)
        OR (status='processing' AND lease_expires_at <= ?))`).bind(body.processorID, leaseExpiresAt, body.processorID, nowISO, candidate.id, nowISO, nowISO).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;
    const payload = JSON.parse(candidate.payload_json) as { objectKey: string };
    const object = await env.TEMP.get(payload.objectKey);
    if (!object) {
      await env.OPS.prepare("UPDATE jobs SET status='retry', last_error='temp object missing', next_attempt_at=?, lease_expires_at=NULL WHERE id=?").bind(new Date(now.getTime() + 60_000).toISOString(), candidate.id).run();
      continue;
    }
    return json({ jobID: candidate.id, runID: candidate.run_id, leaseExpiresAt, input: await object.json() });
  }
  return json({ error: { code: "claim_contention", message: "No job could be leased" } }, 409);
}

async function completeJob(request: Request, env: Env, jobID: string): Promise<Response> {
  const completion = await request.json<CompletionRequest>().catch(() => null);
  if (!completion || !completion.processorID || !sha256Pattern.test(completion.rawSHA256) || !sha256Pattern.test(completion.normalizedSHA256) || (completion.diffSHA256 && !sha256Pattern.test(completion.diffSHA256))) {
    return json({ error: { code: "invalid_completion", message: "processorID and valid SHA-256 values are required" } }, 400);
  }
  const job = await env.OPS.prepare("SELECT run_id, status, claimed_by, lease_expires_at, payload_json FROM jobs WHERE id=?").bind(jobID).first<{ run_id: string; status: string; claimed_by: string | null; lease_expires_at: string | null; payload_json: string }>();
  if (!job) return json({ error: { code: "job_not_found", message: "Job was not found" } }, 404);
  if (job.status === "completed") return json({ jobID, duplicateCompletion: true });
  if (job.status !== "processing" || job.claimed_by !== completion.processorID || !job.lease_expires_at || job.lease_expires_at <= new Date().toISOString()) return json({ error: { code: "lease_invalid", message: "The lease is absent, expired, or owned by another processor" } }, 409);

  const payload = JSON.parse(job.payload_json) as { objectKey: string };
  const tempObject = await env.TEMP.get(payload.objectKey);
  if (!tempObject) return json({ error: { code: "temp_missing", message: "Temporary input is missing" } }, 409);
  const input = validateIngest(await tempObject.json());
  let model = completion.eventReadModel as Record<string, unknown>;
  if (model.id !== input.eventID || model.isSynthetic !== false) return json({ error: { code: "invalid_read_model", message: "Read model must match the event and be non-synthetic" } }, 400);

  const now = new Date().toISOString();
  if (Array.isArray(model.documents)) {
    model = {
      ...model,
      documents: (model.documents as Array<Record<string, unknown>>).map((document) => document.id === input.documentID ? { ...document, firstObservedAt: input.firstObservedAt ?? now, ingestedAt: now } : document)
    };
  }
  const sourceID = `source-${input.sourceCode.toLowerCase()}`;
  const sourceItemID = `${sourceID}:${input.externalID}`;
  const revisionID = crypto.randomUUID();
  const rawObjectID = `raw-${input.documentID}-r${input.revisionNumber}`;
  const normalizedObjectID = `derived-${input.documentID}-r${input.revisionNumber}`;
  const rawKey = `v1/documents/${input.documentID}/revisions/${input.revisionNumber}/raw/${completion.rawSHA256}`;
  const normalizedKey = `v1/documents/${input.documentID}/revisions/${input.revisionNumber}/normalized/${completion.normalizedSHA256}.txt`;
  const reviewID = crypto.randomUUID();
  const draftKey = `v1/drafts/events/${input.eventID}/reviews/${reviewID}.json`;
  const rawBody = input.rawBodyBase64 ? Uint8Array.from(atob(input.rawBodyBase64), (character) => character.charCodeAt(0)) : new TextEncoder().encode(input.bodyText);
  const rawContentType = input.contentType || "text/plain; charset=utf-8";
  const draftBody = JSON.stringify(model);
  const draftObjectID = `derived-draft-${reviewID}`;
  const draftSHA256 = await sha256(draftBody);

  const existing = await env.CORE.prepare("SELECT id, revision_number FROM document_revisions WHERE document_id=? AND content_sha256=?").bind(input.documentID, completion.rawSHA256).first<{ id: string; revision_number: number }>();
  if (existing) {
    await env.OPS.batch([
      env.OPS.prepare("UPDATE jobs SET status='completed', completed_at=?, lease_expires_at=NULL, last_error=NULL WHERE id=?").bind(now, jobID),
      env.OPS.prepare("UPDATE ingestion_runs SET status='completed', completed_at=?, summary_json=? WHERE id=?").bind(now, JSON.stringify({ duplicateRevision: true, revisionNumber: existing.revision_number }), job.run_id),
      env.OPS.prepare("INSERT INTO job_events (job_id,event_kind,detail_json,created_at) VALUES (?,'duplicate_revision',?,?)").bind(jobID, JSON.stringify(existing), now)
    ]);
    await env.TEMP.delete(payload.objectKey);
    return json({ jobID, duplicateRevision: true, revisionNumber: existing.revision_number });
  }

  const latest = await env.CORE.prepare("SELECT MAX(revision_number) AS value FROM document_revisions WHERE document_id=?").bind(input.documentID).first<{ value: number | null }>();
  if (input.revisionNumber !== (latest?.value ?? 0) + 1) return json({ error: { code: "revision_out_of_order", message: `Expected revision ${(latest?.value ?? 0) + 1}` } }, 409);

  const encoder = new TextEncoder();
  let preparedDiff: { id: string; objectID: string; key: string; body: string; previousRevisionID: string } | null = null;
  if (completion.diff && completion.diffSHA256 && input.revisionNumber > 1) {
    const previous = await env.CORE.prepare("SELECT id FROM document_revisions WHERE document_id=? AND revision_number=?").bind(input.documentID, input.revisionNumber - 1).first<{ id: string }>();
    if (!previous) return json({ error: { code: "previous_revision_missing", message: "Previous revision is missing" } }, 409);
    preparedDiff = {
      id: crypto.randomUUID(),
      objectID: `derived-${completion.diffSHA256}`,
      key: `v1/diffs/sha256/${completion.diffSHA256.slice(0, 2)}/${completion.diffSHA256}.json`,
      body: JSON.stringify(completion.diff),
      previousRevisionID: previous.id
    };
  }

  const pendingObjects = [
    { id: rawObjectID, role: "raw", key: rawKey, hash: completion.rawSHA256, contentType: rawContentType, byteLength: rawBody.byteLength },
    { id: normalizedObjectID, role: "derived", key: normalizedKey, hash: completion.normalizedSHA256, contentType: "text/plain; charset=utf-8", byteLength: encoder.encode(completion.normalizedText).byteLength },
    { id: draftObjectID, role: "derived", key: draftKey, hash: draftSHA256, contentType: "application/json", byteLength: encoder.encode(draftBody).byteLength },
    ...(preparedDiff ? [{ id: preparedDiff.objectID, role: "derived", key: preparedDiff.key, hash: completion.diffSHA256!, contentType: "application/json", byteLength: encoder.encode(preparedDiff.body).byteLength }] : [])
  ] as const;

  await env.CORE.batch(pendingObjects.map((object) => env.CORE.prepare(`INSERT INTO storage_objects
    (id,bucket_role,object_key,sha256,content_type,byte_length,created_at,state,source_job_id,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET bucket_role=excluded.bucket_role,object_key=excluded.object_key,sha256=excluded.sha256,
      content_type=excluded.content_type,byte_length=excluded.byte_length,state='pending',source_job_id=excluded.source_job_id,updated_at=excluded.updated_at`)
    .bind(object.id, object.role, object.key, object.hash, object.contentType, object.byteLength, now, "pending", jobID, now)));

  await Promise.all([
    env.RAW.put(rawKey, rawBody, { httpMetadata: { contentType: rawContentType }, customMetadata: { sha256: completion.rawSHA256, sourceURL: input.sourceURL } }),
    env.DERIVED.put(normalizedKey, completion.normalizedText, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: { sha256: completion.normalizedSHA256 } }),
    env.DERIVED.put(draftKey, draftBody, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: draftSHA256, eventID: input.eventID, reviewID } }),
    ...(preparedDiff ? [env.DERIVED.put(preparedDiff.key, preparedDiff.body, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: completion.diffSHA256! } })] : [])
  ]);

  const firstObservedAt = input.firstObservedAt ?? now;
  const availableAt = input.availableAt;
  const timePrecision = resolvedTimePrecision(input);
  const officialPublishedAt = input.availabilityBasis === "source_stated" && timePrecision !== "day" ? availableAt : null;
  const lastActivityAt = model.lastActivityAt as string ?? now;
  const titleJA = model.titleJA as string;
  const titleEN = model.titleEN as string;
  const summaryJA = model.summaryJA as string;
  const status = model.status as string;
  const timeline = Array.isArray(model.timelineItems) ? model.timelineItems as Array<Record<string, unknown>> : [];
  const statements: D1PreparedStatement[] = [
    ...pendingObjects.map((object) => env.CORE.prepare("UPDATE storage_objects SET state='ready',updated_at=? WHERE id=? AND state='pending'").bind(now, object.id)),
    env.CORE.prepare("INSERT INTO sources (id,code,display_name,base_url,source_kind,active,created_at) VALUES (?,?,?,?, 'official',1,?) ON CONFLICT(code) DO UPDATE SET display_name=excluded.display_name,base_url=excluded.base_url,active=1").bind(sourceID, input.sourceCode, input.publisherEN, new URL(input.sourceURL).origin, now),
    env.CORE.prepare(`INSERT INTO source_items (id,source_id,external_id,canonical_url,first_detected_at,last_detected_at,available_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET canonical_url=excluded.canonical_url,last_detected_at=excluded.last_detected_at,available_at=excluded.available_at`).bind(sourceItemID, sourceID, input.externalID, input.sourceURL, firstObservedAt, firstObservedAt, availableAt),
    env.CORE.prepare(`INSERT INTO documents (id,source_item_id,document_number,publisher,title,official_url,document_type,corrects_document_id,source_stated_at,source_stated_timezone,first_observed_at,ingested_at,published_on,effective_on,applicable_on,comments_close_on,available_at,availability_basis,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_item_id=excluded.source_item_id,document_number=excluded.document_number,publisher=excluded.publisher,title=excluded.title,official_url=excluded.official_url,document_type=excluded.document_type,corrects_document_id=excluded.corrects_document_id,source_stated_at=excluded.source_stated_at,source_stated_timezone=excluded.source_stated_timezone,first_observed_at=COALESCE(documents.first_observed_at,excluded.first_observed_at),ingested_at=excluded.ingested_at,published_on=excluded.published_on,effective_on=excluded.effective_on,applicable_on=excluded.applicable_on,comments_close_on=excluded.comments_close_on,available_at=excluded.available_at,availability_basis=excluded.availability_basis`).bind(input.documentID, sourceItemID, input.documentNumber, input.publisherEN, input.titleEN, input.sourceURL, input.documentType, input.correctsDocumentID ?? null, input.sourceStatedAt ?? null, input.sourceStatedTimezone ?? null, firstObservedAt, now, input.publishedOn, input.effectiveOn ?? null, input.applicableOn ?? null, input.commentsCloseOn ?? null, availableAt, input.availabilityBasis, now),
    env.CORE.prepare("INSERT INTO document_revisions (id,document_id,revision_number,raw_object_id,normalized_object_id,official_published_at,first_detected_at,available_at,time_precision,content_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(revisionID, input.documentID, input.revisionNumber, rawObjectID, normalizedObjectID, officialPublishedAt, firstObservedAt, availableAt, timePrecision, completion.rawSHA256, now),
    env.CORE.prepare("UPDATE documents SET current_revision_id=? WHERE id=?").bind(revisionID, input.documentID),
    env.CORE.prepare(`INSERT INTO policy_events (id,agency_code,title_ja,title_en,summary_ja,status,official_published_at,first_detected_at,last_activity_at,published_at,is_synthetic,created_at,updated_at)
      VALUES (?,?,?,?,?,?,NULL,?,?,NULL,0,?,?) ON CONFLICT(id) DO UPDATE SET agency_code=excluded.agency_code,title_ja=excluded.title_ja,title_en=excluded.title_en,summary_ja=excluded.summary_ja,status=excluded.status,last_activity_at=excluded.last_activity_at,updated_at=excluded.updated_at`).bind(input.eventID, input.sourceCode, titleJA, titleEN, summaryJA, status, firstObservedAt, lastActivityAt, now, now),
    env.CORE.prepare("INSERT OR IGNORE INTO policy_analyses (id,event_id,analysis_status,presentation_tier,canonical_title_en,policy_type,policy_domain_codes_json,primary_agency_code,affected_region_codes_json,affected_sector_codes_json,affected_product_terms_json,market_analysis_mode,editorial_priority,analysis_version,created_at,updated_at) VALUES (?,?,'unreviewed','archive',?,'unclassified','[]',?,'[]','[]','[]','unmapped',0,1,?,?)").bind(`${input.eventID}:analysis:1`, input.eventID, titleEN, input.sourceCode, now, now),
    env.CORE.prepare("INSERT INTO event_documents (event_id,document_id,relationship) VALUES (?,?,?) ON CONFLICT(event_id,document_id) DO UPDATE SET relationship=excluded.relationship").bind(input.eventID, input.documentID, input.relationship),
    env.CORE.prepare("DELETE FROM timeline_entries WHERE event_id=?").bind(input.eventID)
  ];
  for (const item of timeline) {
    statements.push(env.CORE.prepare("INSERT INTO timeline_entries (id,event_id,kind,occurred_at,available_at,title_ja,detail_ja,source_type,verification_state,document_revision_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(item.id, input.eventID, item.kind, item.occurredAt, item.occurredAt, item.titleJA, item.detailJA, item.sourceType, item.verificationState, item.documentID === input.documentID ? revisionID : null));
  }

  if (preparedDiff) {
    statements.push(
      env.CORE.prepare("INSERT INTO document_diffs (id,document_id,from_revision_id,to_revision_id,object_id,summary_ja,available_at) VALUES (?,?,?,?,?,?,?)").bind(preparedDiff.id, input.documentID, preparedDiff.previousRevisionID, revisionID, preparedDiff.objectID, input.changeSummaryJA ?? "文書の変更を検出", availableAt)
    );
  }
  statements.push(env.CORE.prepare("INSERT INTO publication_reviews (id,event_id,state,note,created_at,draft_object_key,source_job_id,content_sha256) VALUES (?,?,'draft',NULL,?,?,?,?)").bind(reviewID, input.eventID, now, draftKey, jobID, completion.rawSHA256));

  await env.CORE.batch(statements);
  await env.OPS.batch([
    env.OPS.prepare("UPDATE jobs SET status='completed', completed_at=?, lease_expires_at=NULL, last_error=NULL WHERE id=? AND claimed_by=?").bind(now, jobID, completion.processorID),
    env.OPS.prepare("UPDATE ingestion_runs SET status='completed', completed_at=?, summary_json=? WHERE id=?").bind(now, JSON.stringify({ eventID: input.eventID, revisionNumber: input.revisionNumber, reviewID }), job.run_id),
    env.OPS.prepare("INSERT INTO job_events (job_id,event_kind,detail_json,created_at) VALUES (?,'completed',?,?)").bind(jobID, JSON.stringify({ eventID: input.eventID, revisionNumber: input.revisionNumber, reviewID }), now)
  ]);
  await env.TEMP.delete(payload.objectKey);
  return json({ jobID, eventID: input.eventID, revisionNumber: input.revisionNumber, reviewID, state: "draft" });
}

async function failJob(request: Request, env: Env, jobID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { processorID?: string; error?: string };
  const job = await env.OPS.prepare("SELECT attempt_count,claimed_by FROM jobs WHERE id=?").bind(jobID).first<{ attempt_count: number; claimed_by: string | null }>();
  if (!job) return json({ error: { code: "job_not_found", message: "Job was not found" } }, 404);
  if (!body.processorID || job.claimed_by !== body.processorID) return json({ error: { code: "lease_invalid", message: "Job is owned by another processor" } }, 409);
  const now = new Date();
  const dead = job.attempt_count >= 5;
  const next = new Date(now.getTime() + Math.min(3600, 2 ** job.attempt_count * 30) * 1000).toISOString();
  await env.OPS.prepare("UPDATE jobs SET status=?,next_attempt_at=?,lease_expires_at=NULL,last_error=? WHERE id=?").bind(dead ? "dead" : "retry", next, String(body.error ?? "processor failed").slice(0, 2000), jobID).run();
  return json({ jobID, status: dead ? "dead" : "retry", nextAttemptAt: dead ? null : next });
}

async function publishEvent(request: Request, env: Env, eventID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { reviewedBy?: string; note?: string };
  if (!body.reviewedBy?.trim()) return json({ error: { code: "reviewer_required", message: "reviewedBy is required" } }, 400);
  const review = await env.CORE.prepare("SELECT id,draft_object_key FROM publication_reviews WHERE event_id=? AND state='draft' ORDER BY created_at DESC LIMIT 1").bind(eventID).first<{ id: string; draft_object_key: string }>();
  if (!review) return json({ error: { code: "draft_not_found", message: "No draft review is available" } }, 404);
  const object = await env.DERIVED.get(review.draft_object_key);
  if (!object) return json({ error: { code: "draft_object_missing", message: "Draft read model object is missing" } }, 409);
  const payload = await object.text();
  JSON.parse(payload);
  const now = new Date().toISOString();
  await env.CORE.batch([
    env.CORE.prepare("UPDATE publication_reviews SET state='rejected',reviewed_by=?,reviewed_at=?,note='Superseded by a newer reviewed revision' WHERE event_id=? AND state='draft' AND id<>?").bind(body.reviewedBy, now, eventID, review.id),
    env.CORE.prepare("UPDATE publication_reviews SET state='approved',reviewed_by=?,reviewed_at=?,note=? WHERE id=? AND state='draft'").bind(body.reviewedBy, now, body.note ?? null, review.id),
    env.CORE.prepare("UPDATE policy_events SET published_at=?,updated_at=? WHERE id=?").bind(now, now, eventID),
    env.CORE.prepare(`INSERT INTO event_read_models (event_id,schema_version,payload_json,source_updated_at,generated_at,published_at)
      VALUES (?,4,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET schema_version=excluded.schema_version,payload_json=excluded.payload_json,source_updated_at=excluded.source_updated_at,generated_at=excluded.generated_at,published_at=excluded.published_at`).bind(eventID, payload, now, now, now)
  ]);
  return json({ eventID, reviewID: review.id, state: "published", publishedAt: now });
}

async function publishedModel(env: Env, eventID: string): Promise<{ model: Record<string, unknown>; publishedAt: string } | null> {
  const row = await env.CORE.prepare("SELECT payload_json,published_at FROM event_read_models WHERE event_id=? AND published_at IS NOT NULL").bind(eventID).first<{ payload_json: string; published_at: string }>();
  if (!row) return null;
  return { model: JSON.parse(row.payload_json) as Record<string, unknown>, publishedAt: row.published_at };
}

async function enrichEvent(request: Request, env: Env, eventID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    summaryJA?: string; domainSlug?: string; importantClauseJA?: string; clauseSourceURL?: string;
    confounderReviewState?: string; reviewedBy?: string; note?: string;
  };
  for (const [field, value] of [["summaryJA", body.summaryJA], ["domainSlug", body.domainSlug], ["importantClauseJA", body.importantClauseJA], ["clauseSourceURL", body.clauseSourceURL], ["reviewedBy", body.reviewedBy]] as const) {
    if (!value?.trim()) return json({ error: { code: "invalid_enrichment", message: `${field} is required` } }, 400);
  }
  if (!/^https:\/\//.test(body.clauseSourceURL!)) return json({ error: { code: "invalid_enrichment", message: "clauseSourceURL must use HTTPS" } }, 400);
  const reviewStates = new Set(["verified_none", "candidate", "verified"]);
  if (!body.confounderReviewState || !reviewStates.has(body.confounderReviewState)) return json({ error: { code: "invalid_enrichment", message: "confounderReviewState is invalid" } }, 400);
  const current = await publishedModel(env, eventID);
  if (!current) return json({ error: { code: "event_not_found", message: "A published event is required" } }, 404);
  const domain = await env.CORE.prepare("SELECT slug,label_ja FROM policy_domains WHERE slug=?").bind(body.domainSlug).first<{ slug: string; label_ja: string }>();
  if (!domain) return json({ error: { code: "domain_not_found", message: "Policy domain was not found" } }, 400);
  const pendingRelationships = await env.CORE.prepare(`SELECT COUNT(*) AS count FROM document_relationships
    WHERE review_state='candidate' AND (from_document_id IN (SELECT document_id FROM event_documents WHERE event_id=?)
      OR to_document_id IN (SELECT document_id FROM event_documents WHERE event_id=?))`).bind(eventID, eventID).first<{ count: number }>();
  if ((pendingRelationships?.count ?? 0) > 0) return json({ error: { code: "relationship_review_required", message: "Document relationship candidates must be reviewed first" } }, 409);
  const confounders = Array.isArray(current.model.confounders) ? current.model.confounders : [];
  if (body.confounderReviewState === "verified" && confounders.length === 0) return json({ error: { code: "confounder_state_mismatch", message: "verified requires at least one confounder" } }, 409);
  if (body.confounderReviewState === "verified_none" && confounders.length > 0) return json({ error: { code: "confounder_state_mismatch", message: "verified_none requires zero confounders" } }, 409);
  const now = new Date().toISOString();
  const reviewID = crypto.randomUUID();
  const clauseID = crypto.randomUUID();
  const model = {
    ...current.model,
    summaryJA: body.summaryJA!.trim(),
    coverageState: "analyst_enriched",
    eventVerificationState: "analyst_verified",
    policyDomain: { slug: domain.slug, labelJA: domain.label_ja },
    importantClauses: [{ id: clauseID, textJA: body.importantClauseJA!.trim(), sourceURL: body.clauseSourceURL }],
    confounderReviewState: body.confounderReviewState
  };
  await env.CORE.batch([
    env.CORE.prepare("INSERT INTO analyst_reviews (id,event_id,summary_ja,domain_slug,important_clause_ja,clause_source_url,confounder_review_state,reviewed_by,reviewed_at,note) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(reviewID, eventID, body.summaryJA!.trim(), domain.slug, body.importantClauseJA!.trim(), body.clauseSourceURL, body.confounderReviewState, body.reviewedBy!.trim(), now, body.note?.trim() || null),
    env.CORE.prepare("UPDATE policy_events SET summary_ja=?,coverage_state='analyst_enriched',verification_state='analyst_verified',domain_slug=?,updated_at=? WHERE id=?").bind(body.summaryJA!.trim(), domain.slug, now, eventID),
    env.CORE.prepare("UPDATE event_read_models SET schema_version=4,payload_json=?,source_updated_at=?,generated_at=? WHERE event_id=? AND published_at IS NOT NULL").bind(JSON.stringify(model), now, now, eventID),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'analyst_enrich','policy_event',?,?,?)").bind(crypto.randomUUID(), body.reviewedBy!.trim(), eventID, JSON.stringify({ reviewID, domainSlug: domain.slug, confounderReviewState: body.confounderReviewState }), now)
  ]);
  return json({ eventID, reviewID, coverageState: "analyst_enriched", reviewedAt: now });
}

async function reviewRelationship(request: Request, env: Env, relationshipID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { decision?: string; reviewedBy?: string; note?: string };
  if (!new Set(["approved", "rejected"]).has(body.decision ?? "")) return json({ error: { code: "invalid_relationship_review", message: "decision must be approved or rejected" } }, 400);
  if (!body.reviewedBy?.trim()) return json({ error: { code: "invalid_relationship_review", message: "reviewedBy is required" } }, 400);
  const existing = await env.CORE.prepare("SELECT id FROM document_relationships WHERE id=?").bind(relationshipID).first<{ id: string }>();
  if (!existing) return json({ error: { code: "relationship_not_found", message: "Relationship candidate was not found" } }, 404);
  const now = new Date().toISOString();
  await env.CORE.batch([
    env.CORE.prepare("UPDATE document_relationships SET review_state=?,reviewed_by=?,reviewed_at=? WHERE id=?").bind(body.decision, body.reviewedBy.trim(), now, relationshipID),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'review_relationship','document_relationship',?,?,?)").bind(crypto.randomUUID(), body.reviewedBy.trim(), relationshipID, JSON.stringify({ decision: body.decision, note: body.note?.trim() || null }), now)
  ]);
  return json({ relationshipID, reviewState: body.decision, reviewedAt: now });
}

async function addConfounder(request: Request, env: Env, eventID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    titleJA?: string; detailJA?: string; relevance?: string; kind?: string; sourceURL?: string;
    occurredAt?: string; availableAt?: string; reviewState?: string; reviewedBy?: string;
  };
  for (const [field, value] of [["titleJA", body.titleJA], ["detailJA", body.detailJA], ["relevance", body.relevance], ["kind", body.kind], ["sourceURL", body.sourceURL], ["occurredAt", body.occurredAt], ["availableAt", body.availableAt], ["reviewedBy", body.reviewedBy]] as const) {
    if (!value?.trim()) return json({ error: { code: "invalid_confounder", message: `${field} is required` } }, 400);
  }
  const kinds = new Set(["macro", "issuer_filing", "earnings", "analyst", "peer", "market", "geopolitical", "other"]);
  if (!kinds.has(body.kind!)) return json({ error: { code: "invalid_confounder", message: "kind is invalid" } }, 400);
  if (!new Set(["candidate", "verified"]).has(body.reviewState ?? "")) return json({ error: { code: "invalid_confounder", message: "reviewState must be candidate or verified" } }, 400);
  if (!/^https:\/\//.test(body.sourceURL!)) return json({ error: { code: "invalid_confounder", message: "sourceURL must use HTTPS" } }, 400);
  if (!isISODate(body.occurredAt) || !isISODate(body.availableAt) || Date.parse(body.availableAt!) < Date.parse(body.occurredAt!)) return json({ error: { code: "invalid_confounder", message: "occurredAt/availableAt must be ordered ISO-8601 timestamps" } }, 400);
  const current = await publishedModel(env, eventID);
  if (!current) return json({ error: { code: "event_not_found", message: "A published event is required" } }, 404);
  const now = new Date().toISOString();
  const confounderID = crypto.randomUUID();
  const verificationState = body.reviewState === "verified" ? "humanVerified" : "automaticUnverified";
  const confounder = { id: confounderID, titleJA: body.titleJA!.trim(), detailJA: body.detailJA!.trim(), relevance: body.relevance!.trim(), kind: body.kind, sourceURL: body.sourceURL, occurredAt: body.occurredAt, availableAt: body.availableAt, verificationState };
  const existing = Array.isArray(current.model.confounders) ? current.model.confounders : [];
  const model = { ...current.model, confounders: [...existing, confounder], confounderReviewState: body.reviewState };
  await env.CORE.batch([
    env.CORE.prepare("INSERT INTO confounders (id,event_id,occurred_at,available_at,title_ja,detail_ja,verification_state,kind,relevance,source_url,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(confounderID, eventID, body.occurredAt, body.availableAt, body.titleJA!.trim(), body.detailJA!.trim(), verificationState, body.kind, body.relevance!.trim(), body.sourceURL, body.reviewedBy!.trim(), now),
    env.CORE.prepare("UPDATE event_read_models SET schema_version=4,payload_json=?,source_updated_at=?,generated_at=? WHERE event_id=? AND published_at IS NOT NULL").bind(JSON.stringify(model), now, now, eventID),
    env.CORE.prepare("UPDATE policy_events SET updated_at=? WHERE id=?").bind(now, eventID),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'add_confounder','confounder',?,?,?)").bind(crypto.randomUUID(), body.reviewedBy!.trim(), confounderID, JSON.stringify({ eventID, reviewState: body.reviewState, sourceURL: body.sourceURL }), now)
  ]);
  return json({ eventID, confounderID, reviewState: body.reviewState, availableAt: body.availableAt });
}

async function reviewMarketProvider(request: Request, env: Env, providerID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { decision?: string; rightsNote?: string; reviewedBy?: string };
  if (!new Set(["approved", "rejected"]).has(body.decision ?? "")) return json({ error: { code: "invalid_provider_review", message: "decision must be approved or rejected" } }, 400);
  if (!body.rightsNote?.trim() || !body.reviewedBy?.trim()) return json({ error: { code: "invalid_provider_review", message: "rightsNote and reviewedBy are required" } }, 400);
  const provider = await env.CORE.prepare("SELECT id,license_mode FROM market_data_providers WHERE id=?").bind(providerID).first<{ id: string; license_mode: string }>();
  if (!provider) return json({ error: { code: "provider_not_found", message: "Market-data provider was not found" } }, 404);
  if (provider.license_mode === "market_disabled") return json({ error: { code: "provider_not_reviewable", message: "market_disabled cannot be approved for display" } }, 409);
  const now = new Date().toISOString();
  await env.CORE.batch([
    env.CORE.prepare("UPDATE market_data_providers SET enabled=?,rights_review_state=?,rights_reviewed_by=?,rights_reviewed_at=?,rights_note=? WHERE id=?").bind(body.decision === "approved" ? 1 : 0, body.decision, body.reviewedBy.trim(), now, body.rightsNote.trim(), providerID),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'review_market_rights','market_data_provider',?,?,?)").bind(crypto.randomUUID(), body.reviewedBy.trim(), providerID, JSON.stringify({ decision: body.decision, rightsNote: body.rightsNote.trim() }), now)
  ]);
  return json({ providerID, rightsReviewState: body.decision, enabled: body.decision === "approved", reviewedAt: now });
}

type MarketMappingRequest = {
  ticker?: string; exchange?: string; companyName?: string; relationship?: string; confidence?: number;
  evidenceDocumentID?: string; evidenceClause?: string; evidenceURL?: string; benchmarkTicker?: string;
  providerID?: string; windowName?: string; windowStart?: string; windowEnd?: string; timePrecision?: string;
  evaluatedAt?: string; availableAt?: string; reviewedBy?: string; points?: ReviewedNormalizedPoint[];
};

async function addMarketMapping(request: Request, env: Env, eventID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as MarketMappingRequest;
  for (const [field, value] of [["ticker", body.ticker], ["exchange", body.exchange], ["companyName", body.companyName], ["relationship", body.relationship], ["evidenceDocumentID", body.evidenceDocumentID], ["evidenceClause", body.evidenceClause], ["evidenceURL", body.evidenceURL], ["benchmarkTicker", body.benchmarkTicker], ["providerID", body.providerID], ["windowName", body.windowName], ["windowStart", body.windowStart], ["windowEnd", body.windowEnd], ["timePrecision", body.timePrecision], ["evaluatedAt", body.evaluatedAt], ["availableAt", body.availableAt], ["reviewedBy", body.reviewedBy]] as const) {
    if (!value?.trim()) return json({ error: { code: "invalid_market_mapping", message: `${field} is required` } }, 400);
  }
  const relationships = new Set(["direct", "indirect", "supplier", "supply_chain", "customer", "competitor", "sector_proxy", "benchmark", "geographic_exposure", "policy_beneficiary", "policy_risk"]);
  if (!relationships.has(body.relationship!)) return json({ error: { code: "invalid_market_mapping", message: "relationship is invalid" } }, 400);
  if (typeof body.confidence !== "number" || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1) return json({ error: { code: "invalid_market_mapping", message: "confidence must be between 0 and 1" } }, 400);
  if (!/^https:\/\//.test(body.evidenceURL!)) return json({ error: { code: "invalid_market_mapping", message: "evidenceURL must use HTTPS" } }, 400);
  const windows = new Set(["fiveMinutes", "thirtyMinutes", "twoHours", "sameDayClose", "nextDayClose", "fiveTradingDays", "nextRegularSessionOpen", "fiveMinutesAfterOpen", "thirtyMinutesAfterOpen", "twoHoursAfterOpen", "previousCloseToOpen", "previousCloseToClose", "closeToNextClose", "fiveTradingDayReturn", "thirtyMinutesFromDetection"]);
  if (!windows.has(body.windowName!)) return json({ error: { code: "invalid_market_mapping", message: "windowName is invalid" } }, 400);
  if (!new Set(["exact", "minute", "hour", "day"]).has(body.timePrecision!)) return json({ error: { code: "invalid_market_mapping", message: "timePrecision is invalid" } }, 400);
  if (!isUUID(body.evidenceDocumentID)) return json({ error: { code: "invalid_market_mapping", message: "evidenceDocumentID must be a UUID" } }, 400);
  if (!Array.isArray(body.points)) return json({ error: { code: "invalid_market_mapping", message: "points are required" } }, 400);

  const current = await publishedModel(env, eventID);
  if (!current) return json({ error: { code: "event_not_found", message: "A published event is required" } }, 404);
  if (!new Set(["analyst_enriched", "market_mapped"]).has(String(current.model.coverageState))) return json({ error: { code: "analyst_review_required", message: "Analyst enrichment is required before market mapping" } }, 409);
  if (!new Set(["verified_none", "verified"]).has(String(current.model.confounderReviewState))) return json({ error: { code: "confounder_review_required", message: "Confounders must be explicitly reviewed before market mapping" } }, 409);

  const provider = await env.CORE.prepare("SELECT id,display_name,license_mode,attribution,delay_status,enabled,rights_review_state,rights_reviewed_by,rights_reviewed_at FROM market_data_providers WHERE id=?").bind(body.providerID).first<{ id: string; display_name: string; license_mode: string; attribution: string | null; delay_status: string | null; enabled: number; rights_review_state: string; rights_reviewed_by: string | null; rights_reviewed_at: string | null }>();
  if (!provider || provider.enabled !== 1 || provider.license_mode === "market_disabled" || provider.rights_review_state !== "approved" || !provider.rights_reviewed_by || !provider.rights_reviewed_at) return json({ error: { code: "market_rights_required", message: "An enabled provider with an approved display-rights review is required" } }, 409);
  const security = await env.CORE.prepare("SELECT id,ticker,exchange,company_name FROM securities WHERE ticker=? COLLATE NOCASE AND exchange=? COLLATE NOCASE AND active=1").bind(body.ticker, body.exchange).first<{ id: string; ticker: string; exchange: string; company_name: string | null }>();
  if (!security) return json({ error: { code: "security_not_found", message: "The active ticker/exchange pair was not found" } }, 400);
  const benchmark = await env.CORE.prepare("SELECT id,ticker FROM securities WHERE ticker=? COLLATE NOCASE AND is_benchmark=1 AND active=1").bind(body.benchmarkTicker).first<{ id: string; ticker: string }>();
  if (!benchmark) return json({ error: { code: "benchmark_not_found", message: "An active benchmark security is required" } }, 400);
  const evidenceDocument = await env.CORE.prepare("SELECT 1 AS found FROM event_documents WHERE event_id=? AND document_id=?").bind(eventID, body.evidenceDocumentID).first<{ found: number }>();
  if (!evidenceDocument) return json({ error: { code: "evidence_document_mismatch", message: "Evidence document does not belong to this event" } }, 400);
  if (!isISODate(body.evaluatedAt) || !isISODate(body.availableAt)
    || Date.parse(body.evaluatedAt!) < Date.parse(body.windowEnd!)
    || Date.parse(body.availableAt!) < Date.parse(body.evaluatedAt!)) {
    return json({ error: { code: "invalid_market_mapping", message: "evaluatedAt must follow windowEnd and availableAt must follow evaluatedAt" } }, 400);
  }
  let study;
  try { study = calculateReviewedMarketStudy(body.points, body.availableAt!, body.windowStart!, body.windowEnd!); }
  catch (error) { return json({ error: { code: "invalid_market_study", message: error instanceof Error ? error.message : String(error) } }, 400); }

  const existingExposure = await env.CORE.prepare("SELECT id FROM company_exposures WHERE event_id=? AND security_id=? AND relationship=?").bind(eventID, security.id, body.relationship).first<{ id: string }>();
  const existingWindow = await env.CORE.prepare("SELECT id FROM market_windows WHERE event_id=? AND security_id=? AND provider_id=? AND window_start=? AND window_end=?").bind(eventID, security.id, provider.id, body.windowStart, body.windowEnd).first<{ id: string }>();
  const existingEvaluation = await env.CORE.prepare("SELECT id FROM market_evaluations WHERE event_id=? AND ticker=? AND benchmark_ticker=? AND window_name=?").bind(eventID, security.ticker, benchmark.ticker, body.windowName).first<{ id: string }>();
  const exposureID = existingExposure?.id ?? crypto.randomUUID();
  const windowID = existingWindow?.id ?? crypto.randomUUID();
  const evaluationID = existingEvaluation?.id ?? crypto.randomUUID();
  const evidenceID = crypto.randomUUID();
  const now = new Date().toISOString();
  const exposures = Array.isArray(current.model.exposures) ? current.model.exposures as Array<Record<string, unknown>> : [];
  const exposure = { id: exposureID, ticker: security.ticker, companyName: body.companyName!.trim(), relationship: body.relationship, evidenceJA: body.evidenceClause!.trim(), verificationState: "humanVerified", references: [{ labelJA: "根拠条項", valueJA: body.evidenceClause!.trim() }, { labelJA: "公式URL", valueJA: body.evidenceURL }] };
  const marketSummaries = Array.isArray(current.model.marketSummaries) ? current.model.marketSummaries as Array<Record<string, unknown>> : [];
  const timelineItems = Array.isArray(current.model.timelineItems) ? current.model.timelineItems as Array<Record<string, unknown>> : [];
  const summary = { window: body.windowName, ticker: security.ticker, benchmarkTicker: benchmark.ticker, ...study.summary };
  const model = {
    ...current.model,
    tickers: [...new Set([...(Array.isArray(current.model.tickers) ? current.model.tickers as string[] : []), security.ticker])],
    exposures: [...exposures.filter((item) => item.id !== exposureID), exposure],
    marketSummaries: [summary, ...marketSummaries.filter((item) => !(item.ticker === security.ticker && item.benchmarkTicker === benchmark.ticker && item.window === body.windowName))],
    marketSeries: study.points,
    marketProvenance: { provider: provider.display_name, licenseMode: provider.license_mode, attribution: provider.attribution ?? provider.display_name, delayStatus: provider.delay_status },
    timelineItems: [...timelineItems.filter((item) => item.id !== evaluationID), { id: evaluationID, kind: "marketReaction", occurredAt: body.windowEnd, availableAt: body.availableAt, titleJA: "市場評価を確定", detailJA: `${security.ticker}を${benchmark.ticker}と比較。公式公開後の値動きであり、因果関係は未確定。`, sourceType: "market", verificationState: "calculated" }],
    coverageState: "market_mapped",
    eventVerificationState: "analyst_verified"
  };
  const relationType = body.relationship === "supplier" ? "supply_chain" : body.relationship === "sector_proxy" || body.relationship === "benchmark" ? "indirect" : body.relationship;
  const statements = [
    env.CORE.prepare("INSERT INTO company_exposures (id,event_id,security_id,relationship,confidence,origin,review_state,reviewed_by,reviewed_at,relation_type,review_status) VALUES (?,?,?,?,?,'manual','approved',?,?,?,'approved') ON CONFLICT(event_id,security_id,relationship) DO UPDATE SET confidence=excluded.confidence,origin='manual',review_state='approved',reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,relation_type=excluded.relation_type,review_status='approved'").bind(exposureID, eventID, security.id, body.relationship, body.confidence, body.reviewedBy!.trim(), now, relationType),
    env.CORE.prepare("DELETE FROM exposure_evidence WHERE exposure_id=?").bind(exposureID),
    env.CORE.prepare("INSERT INTO exposure_evidence (id,exposure_id,document_id,clause_text,source_url,created_at,evidence_reference,evidence_summary_ja) VALUES (?,?,?,?,?,?,?,?)").bind(evidenceID, exposureID, body.evidenceDocumentID, body.evidenceClause!.trim(), body.evidenceURL, now, body.evidenceClause!.trim(), body.evidenceClause!.trim()),
    env.CORE.prepare("UPDATE securities SET company_name=? WHERE id=?").bind(body.companyName!.trim(), security.id),
    env.CORE.prepare("INSERT INTO market_windows (id,event_id,security_id,provider_id,window_start,window_end,time_precision,benchmark_security_id,evaluated_at,license_mode,attribution) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,security_id,provider_id,window_start,window_end) DO UPDATE SET time_precision=excluded.time_precision,benchmark_security_id=excluded.benchmark_security_id,evaluated_at=excluded.evaluated_at,license_mode=excluded.license_mode,attribution=excluded.attribution").bind(windowID, eventID, security.id, provider.id, body.windowStart, body.windowEnd, body.timePrecision, benchmark.id, body.evaluatedAt, provider.license_mode, provider.attribution),
    env.CORE.prepare("INSERT INTO market_evaluations (id,event_id,ticker,benchmark_ticker,window_name,security_return,benchmark_return,abnormal_return,max_volume_ratio,abnormal_reaction_detected,available_at,window_id,provider_id,evaluated_at,time_precision,license_mode,attribution,delay_status,evidence_url,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,ticker,benchmark_ticker,window_name) DO UPDATE SET security_return=excluded.security_return,benchmark_return=excluded.benchmark_return,abnormal_return=excluded.abnormal_return,max_volume_ratio=excluded.max_volume_ratio,abnormal_reaction_detected=excluded.abnormal_reaction_detected,available_at=excluded.available_at,window_id=excluded.window_id,provider_id=excluded.provider_id,evaluated_at=excluded.evaluated_at,time_precision=excluded.time_precision,license_mode=excluded.license_mode,attribution=excluded.attribution,delay_status=excluded.delay_status,evidence_url=excluded.evidence_url,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at").bind(evaluationID, eventID, security.ticker, benchmark.ticker, body.windowName, study.summary.securityReturn, study.summary.benchmarkReturn, study.summary.abnormalReturn, study.summary.maxVolumeRatio, study.summary.abnormalReactionDetected ? 1 : 0, body.availableAt, windowID, provider.id, body.evaluatedAt, body.timePrecision, provider.license_mode, provider.attribution, provider.delay_status, body.evidenceURL, body.reviewedBy!.trim(), now),
    env.CORE.prepare("DELETE FROM market_points WHERE evaluation_id=?").bind(evaluationID),
    ...study.points.map((point) => env.CORE.prepare("INSERT INTO market_points (id,evaluation_id,observed_at,available_at,normalized_security_price,normalized_benchmark_price,abnormal_return_points,volume_ratio) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), evaluationID, point.timestamp, body.availableAt, point.normalizedSecurityPrice, point.normalizedBenchmarkPrice, point.abnormalReturnPoints, point.volumeRatio)),
    env.CORE.prepare("UPDATE policy_events SET coverage_state='market_mapped',verification_state='analyst_verified',updated_at=? WHERE id=?").bind(now, eventID),
    env.CORE.prepare("UPDATE event_read_models SET schema_version=4,payload_json=?,source_updated_at=?,generated_at=? WHERE event_id=? AND published_at IS NOT NULL").bind(JSON.stringify(model), now, now, eventID),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'approve_market_mapping','market_evaluation',?,?,?)").bind(crypto.randomUUID(), body.reviewedBy!.trim(), evaluationID, JSON.stringify({ eventID, exposureID, providerID: provider.id, ticker: security.ticker, benchmarkTicker: benchmark.ticker, evidenceURL: body.evidenceURL }), now)
  ];
  await env.CORE.batch(statements);
  return json({ eventID, exposureID, evaluationID, coverageState: "market_mapped", reviewedAt: now, calculatedSummary: study.summary });
}

async function latestModel(env: Env, eventID: string): Promise<Response> {
  const review = await env.CORE.prepare("SELECT draft_object_key FROM publication_reviews WHERE event_id=? AND state='draft' ORDER BY created_at DESC LIMIT 1").bind(eventID).first<{ draft_object_key: string }>();
  if (review?.draft_object_key) {
    const object = await env.DERIVED.get(review.draft_object_key);
    if (object) return json({ source: "draft", model: JSON.parse(await object.text()) });
  }
  const published = await env.CORE.prepare("SELECT payload_json FROM event_read_models WHERE event_id=? AND published_at IS NOT NULL").bind(eventID).first<{ payload_json: string }>();
  if (published) return json({ source: "published", model: JSON.parse(published.payload_json) });
  return json({ error: { code: "model_not_found", message: "No prior model exists" } }, 404);
}

async function status(env: Env): Promise<Response> {
  const [queued, drafts, published, storage, relationships, correctionQueue, analystQueue, failures, duplicates, sourceHealth, marketProviders, marketMapped, analysisQueue, companyRelations, translation] = await Promise.all([
    env.OPS.prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status").all(),
    env.CORE.prepare("SELECT id,event_id,created_at,content_sha256 FROM publication_reviews WHERE state='draft' ORDER BY created_at DESC").all(),
    env.CORE.prepare("SELECT event_id,published_at FROM event_read_models WHERE published_at IS NOT NULL ORDER BY published_at DESC").all(),
    env.CORE.prepare("SELECT state,COUNT(*) AS count FROM storage_objects GROUP BY state").all(),
    env.CORE.prepare("SELECT id,from_document_id,to_document_id,relationship,confidence,review_state,created_at FROM document_relationships WHERE review_state='candidate' ORDER BY confidence DESC,created_at DESC LIMIT 100").all(),
    env.CORE.prepare("SELECT relationship.id,relationship.from_document_id,relationship.to_document_id,relationship.relationship,relationship.confidence,relationship.created_at FROM document_relationships relationship JOIN documents document ON document.id=relationship.from_document_id WHERE relationship.review_state='candidate' AND (relationship.relationship IN ('corrects','rescinds','supersedes') OR document.document_type='correcting_amendment') ORDER BY relationship.created_at DESC LIMIT 100").all(),
    env.CORE.prepare("SELECT id,agency_code,title_ja,coverage_state,verification_state,updated_at FROM policy_events WHERE coverage_state NOT IN ('analyst_enriched','market_mapped') ORDER BY updated_at DESC LIMIT 100").all(),
    env.OPS.prepare("SELECT id,status,attempt_count,last_error,next_attempt_at FROM jobs WHERE status IN ('retry','dead') ORDER BY COALESCE(next_attempt_at,available_at) LIMIT 100").all(),
    env.OPS.prepare("SELECT job_id,detail_json,created_at FROM job_events WHERE event_kind='duplicate_revision' ORDER BY created_at DESC LIMIT 100").all(),
    env.OPS.prepare("SELECT source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json FROM source_health ORDER BY source_code").all(),
    env.CORE.prepare("SELECT id,display_name,license_mode,attribution,delay_status,enabled,rights_review_state,rights_reviewed_by,rights_reviewed_at,rights_note FROM market_data_providers ORDER BY id").all(),
    env.CORE.prepare("SELECT id,agency_code,title_ja,coverage_state,updated_at FROM policy_events WHERE coverage_state='market_mapped' ORDER BY updated_at DESC LIMIT 100").all(),
    env.CORE.prepare("SELECT id,event_id,analysis_status,presentation_tier,market_analysis_mode,analysis_version,updated_at,reviewed_by,reviewed_at,published_at FROM policy_analyses ORDER BY updated_at DESC LIMIT 200").all(),
    env.CORE.prepare("SELECT id,event_id,issuer_id,security_id,relation_type,review_status,updated_at,reviewed_by,reviewed_at FROM policy_company_relations ORDER BY updated_at DESC LIMIT 200").all(),
    translationOperationalStatus(env)
  ]);
  return json({
    environment: env.ENVIRONMENT,
    jobs: queued.results,
    failures: failures.results,
    duplicateRevisions: duplicates.results,
    publicationQueue: drafts.results,
    published: published.results,
    relationshipCandidates: relationships.results,
    correctionQueue: correctionQueue.results,
    analystQueue: analystQueue.results,
    analysisQueue: analysisQueue.results,
    companyRelations: companyRelations.results,
    marketProviders: marketProviders.results,
    marketMapped: marketMapped.results,
    sourceHealth: sourceHealth.results,
    storage: storage.results,
    translation
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal/translations/realtime/run") {
      if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "POST is required" } }, 405);
      if (!(await isTranslationTriggerAuthorized(request, env))) {
        return json({ error: { code: "unauthorized", message: "A valid translation trigger token is required" } }, 401);
      }
      const body = await request.json().catch(() => null) as { eventID?: unknown } | null;
      if (!isUUID(body?.eventID)) {
        return json({ error: { code: "invalid_event_id", message: "eventID must be a UUID" } }, 400);
      }
      const processing = await processRealtimeTranslationForEvent(env, body.eventID);
      return json({ processing }, processing.state === "missing_credentials" ? 503 : 200);
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
      if (env.ENVIRONMENT.toLowerCase() === "production" && !isAuthorized(request, env)) return unauthorized();
      return adminHTML();
    }
    if (!isAuthorized(request, env)) return unauthorized();
    if (!hasSafeMutationOrigin(request)) return json({ error: { code: "origin_rejected", message: "Cross-origin admin mutation was rejected" } }, 403);
    if (request.method === "GET" && url.pathname === "/admin/status") return status(env);
    if (request.method === "POST" && url.pathname === "/admin/discover/federal-register") {
      const body = await request.json().catch(() => ({})) as { limit?: number };
      return json(await discoverFederalRegister(env, Math.min(Math.max(body.limit ?? 100, 1), 250)));
    }
    if (request.method === "POST" && url.pathname === "/admin/check/white-house") return json(await checkWhiteHouse(env));
    if (request.method === "POST" && url.pathname === "/admin/check/regulations-gov") return json(await checkRegulationsGov(env));
    if (request.method === "GET" && url.pathname === "/admin/translations/status") return json(await translationOperationalStatus(env));
    if (request.method === "POST" && url.pathname === "/admin/translations/queue") return json(await queueTranslationCandidates(env));
    if (request.method === "POST" && url.pathname === "/admin/translations/realtime/run") {
      const queue = await queueTranslationCandidates(env);
      const processing = await processRealtimeTranslations(env);
      return json({ queue, processing });
    }
    if (request.method === "POST" && url.pathname === "/admin/translations/batch/prepare") {
      const body = await request.json().catch(() => ({})) as { maximumItems?: number };
      try { return json(await prepareBatchManifest(env, body.maximumItems ?? 500), 201); }
      catch (error) { return json({ error: { code: "batch_prepare_failed", message: String(error) } }, 400); }
    }
    const batchSubmit = url.pathname.match(/^\/admin\/translations\/batch\/([^/]+)\/submit$/);
    if (request.method === "POST" && batchSubmit) {
      const body = await request.json().catch(() => ({})) as { confirmation?: string };
      if (!body.confirmation) return json({ error: { code: "batch_confirmation_required", message: "Exact confirmation text is required" } }, 400);
      try { return json(await submitBatchManifest(env, batchSubmit[1], body.confirmation), 202); }
      catch (error) { return json({ error: { code: "batch_submit_failed", message: String(error) } }, 400); }
    }
    if (request.method === "POST" && url.pathname === "/admin/translations/batches/poll") return json(await pollSubmittedBatches(env));
    if (request.method === "POST" && url.pathname === "/admin/maintenance/storage/repair") {
      const body = await request.json().catch(() => ({})) as { minimumAgeSeconds?: number };
      const minimumAgeSeconds = Math.min(Math.max(Math.floor(body.minimumAgeSeconds ?? 3600), 900), 86_400);
      return json(await repairPendingStorage(env, new Date(), minimumAgeSeconds));
    }
    const analysisDraft = url.pathname.match(/^\/admin\/events\/([^/]+)\/analysis-drafts$/);
    if (request.method === "POST" && analysisDraft) return createAnalysisDraft(request, env, analysisDraft[1]);
    const analysisReplace = url.pathname.match(/^\/admin\/analyses\/([^/]+)$/);
    if (request.method === "PUT" && analysisReplace) return replaceAnalysisDraft(request, env, analysisReplace[1]);
    const analysisTransition = url.pathname.match(/^\/admin\/analyses\/([^/]+)\/transition$/);
    if (request.method === "POST" && analysisTransition) return transitionAnalysis(request, env, analysisTransition[1]);
    const analysisPreviewRoute = url.pathname.match(/^\/admin\/events\/([^/]+)\/analysis-preview$/);
    if (request.method === "GET" && analysisPreviewRoute) return analysisPreview(env, analysisPreviewRoute[1]);
    const analysisHistoryRoute = url.pathname.match(/^\/admin\/events\/([^/]+)\/analysis-history$/);
    if (request.method === "GET" && analysisHistoryRoute) return analysisHistory(env, analysisHistoryRoute[1]);
    const companyCandidate = url.pathname.match(/^\/admin\/events\/([^/]+)\/company-relations$/);
    if (request.method === "POST" && companyCandidate) return addCompanyRelationCandidate(request, env, companyCandidate[1]);
    const companyReview = url.pathname.match(/^\/admin\/company-relations\/([^/]+)\/review$/);
    if (request.method === "POST" && companyReview) return reviewCompanyRelation(request, env, companyReview[1]);
    const enrich = url.pathname.match(/^\/admin\/events\/([^/]+)\/enrich$/);
    if (request.method === "POST" && enrich) return enrichEvent(request, env, enrich[1]);
    const confounder = url.pathname.match(/^\/admin\/events\/([^/]+)\/confounders$/);
    if (request.method === "POST" && confounder) return addConfounder(request, env, confounder[1]);
    const marketMapping = url.pathname.match(/^\/admin\/events\/([^/]+)\/market-mappings$/);
    if (request.method === "POST" && marketMapping) return addMarketMapping(request, env, marketMapping[1]);
    const providerReview = url.pathname.match(/^\/admin\/market-providers\/([^/]+)\/review$/);
    if (request.method === "POST" && providerReview) return reviewMarketProvider(request, env, providerReview[1]);
    const relationshipReview = url.pathname.match(/^\/admin\/relationships\/([^/]+)\/review$/);
    if (request.method === "POST" && relationshipReview) return reviewRelationship(request, env, relationshipReview[1]);
    const latest = url.pathname.match(/^\/admin\/events\/([^/]+)\/latest-model$/);
    if (request.method === "GET" && latest) return latestModel(env, latest[1]);
    if (request.method === "POST" && url.pathname === "/admin/ingests") return createIngest(request, env);
    if (request.method === "POST" && url.pathname === "/admin/jobs/claim") return claimJob(request, env);
    const complete = url.pathname.match(/^\/admin\/jobs\/([^/]+)\/complete$/);
    if (request.method === "POST" && complete) return completeJob(request, env, complete[1]);
    const fail = url.pathname.match(/^\/admin\/jobs\/([^/]+)\/fail$/);
    if (request.method === "POST" && fail) return failJob(request, env, fail[1]);
    const publish = url.pathname.match(/^\/admin\/events\/([^/]+)\/publish$/);
    if (request.method === "POST" && publish) return publishEvent(request, env, publish[1]);
    return json({ error: { code: "route_not_found", message: "Admin route was not found" } }, 404);
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil((async () => {
      await Promise.allSettled([discoverFederalRegister(env, 100), checkWhiteHouse(env), checkRegulationsGov(env), repairPendingStorage(env)]);
      await queueTranslationCandidates(env);
      await processRealtimeTranslations(env);
      await pollSubmittedBatches(env);
    })());
  }
} satisfies ExportedHandler<Env>;
