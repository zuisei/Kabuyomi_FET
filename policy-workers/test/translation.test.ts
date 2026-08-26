import assert from "node:assert/strict";
import test from "node:test";
import type { PolicyEvent } from "../src/domain/types.ts";
import {
  OpenAIAPIError,
  applyPublicTranslation,
  defaultRealtimeCutoff,
  defaultTranslationModel,
  estimatedTranslationTokens,
  normalizeGeneratedTranslation,
  preserveRequiredTitleIdentifiers,
  requestOpenAITranslation,
  translationLane,
  translationRequestBody,
  translationSourceForEvent,
  validateTranslation,
  type PolicyTranslationRow,
  type TranslationSource
} from "../src/translation/model.ts";
import { batchConfirmationText, submitBatchManifest, type TranslationEnv } from "../src/translation/service.ts";

const hash = "a".repeat(64);

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  isSynthetic: false,
  lastActivityAt: "2026-07-21T15:00:00.000Z",
  agency: { code: "CFTC", displayNameJA: "商品先物取引委員会", displayNameEN: "Commodity Futures Trading Commission" },
  titleJA: "CFTC Order Ending 2026 Reporting Requirements",
  titleEN: "CFTC Order Ending 2026 Reporting Requirements",
  summaryJA: "日本語要約は未作成です。",
  topics: [], tickers: [], status: "published", publishedAt: null, revisedAt: null,
  documentInfo: { documentNumber: "2026-42", contentHash: { algorithm: "sha256", value: hash } },
  timelineItems: [], marketSeries: [], marketSummaries: [], confounders: [], correctionNotes: [],
  instrumentType: "notice",
  documents: [{
    id: "22222222-2222-4222-8222-222222222222", documentType: "notice", relationship: "primary", correctsDocumentID: null,
    documentNumber: "2026-42", publisherJA: "CFTC", publisherEN: "CFTC",
    titleJA: "CFTC Order Ending 2026 Reporting Requirements", titleEN: "CFTC Order Ending 2026 Reporting Requirements",
    officialURL: "https://example.test/official", publishedOn: "2026-07-22", effectiveOn: null, applicableOn: null,
    sourceStatedAt: null, sourceStatedTimezone: null, firstObservedAt: "2026-07-21T15:00:00.000Z",
    ingestedAt: "2026-07-21T15:00:01.000Z", availableAt: "2026-07-21T15:00:00.000Z",
    availabilityBasis: "publication_date_only", timePrecision: "day", currentRevision: 1,
    contentHash: { algorithm: "sha256", value: hash }, bodyJA: "未作成",
    bodyEN: "The CFTC ends specified large trader reporting requirements in 2026."
  }]
} as unknown as PolicyEvent;

test("today-and-future records are realtime while earlier records remain Batch candidates", () => {
  assert.equal(defaultRealtimeCutoff, "2026-07-21T15:00:00.000Z");
  assert.equal(translationLane("2026-07-21T14:59:59.999Z"), "batch");
  assert.equal(translationLane("2026-07-21T15:00:00.000Z"), "realtime");
  assert.equal(translationLane("2026-08-01T00:00:00.000Z"), "realtime");
  assert.equal(translationLane("2020-01-01T00:00:00.000Z", defaultRealtimeCutoff, true), "manual_priority");
});

test("translation source is versioned by the official content hash and current availability", () => {
  const source = translationSourceForEvent(event)!;
  assert.equal(source.sourceContentHash, hash);
  assert.equal(source.sourceAvailableAt, "2026-07-21T15:00:00.000Z");
  assert.match(source.factualSourceEN, /large trader reporting requirements/);
  const estimate = estimatedTranslationTokens(source);
  assert.ok(estimate.input > 0);
  assert.equal(estimate.total, estimate.input + estimate.output);
});

test("OpenAI request is non-persistent and constrained to the translation JSON schema", () => {
  const body = translationRequestBody(translationSourceForEvent(event)!, defaultTranslationModel) as any;
  assert.equal(body.model, "gpt-5-nano-2025-08-07");
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, "minimal");
  assert.equal(body.max_output_tokens, 1_200);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, ["titleJA", "factualSummaryJA"]);

  const repair = translationRequestBody(
    translationSourceForEvent(event)!,
    defaultTranslationModel,
    ["title_has_no_japanese_script"],
    {
      titleJA: "Acrylonitrile；訂正",
      factualSummaryJA: "OSHAはアクリロニトリル基準について意見を募集します。"
    }
  ) as any;
  assert.match(repair.input[0].content[0].text, /previous result failed validation/);
  assert.match(repair.input[0].content[0].text, /title_has_no_japanese_script/);
  assert.match(repair.input[0].content[0].text, /Acrylonitrile as アクリロニトリル/);
  assert.match(repair.input[0].content[0].text, /previous rejected translation is included as data/i);
  assert.match(repair.input[1].content[0].text, /Acrylonitrile；訂正/);
  assert.doesNotMatch(repair.input[0].content[0].text, /For this exact source title/);

  const commonNoticeSource = {
    ...translationSourceForEvent(event)!,
    titleEN: "Agency Information Collection Activities: Proposed Collection; Comment Request"
  };
  const commonNoticeRepair = translationRequestBody(commonNoticeSource, defaultTranslationModel, ["title_has_no_japanese_script"]) as any;
  assert.match(commonNoticeRepair.input[0].content[0].text, /情報収集活動：収集案・意見募集/);

  const identifierSource = {
    ...translationSourceForEvent(event)!,
    titleEN: "USCIS Immigration Fees Required by H.R.1; Correction"
  };
  const identifierRepair = translationRequestBody(identifierSource, defaultTranslationModel, ["title_dropped_number", "title_dropped_acronym"]) as any;
  assert.match(identifierRepair.input[0].content[0].text, /USCIS/);
  assert.match(identifierRepair.input[0].content[0].text, /H\.R\.1/);
  assert.match(identifierRepair.input[0].content[0].text, /；訂正/);
  assert.match(identifierRepair.input[0].content[0].text, /義務付けられた/);
  assert.doesNotMatch(identifierRepair.input[0].content[0].text, /For this exact source title/);
});

test("translation validation accepts literal Japanese and rejects dropped identifiers or market interpretation", () => {
  const source = translationSourceForEvent(event)!;
  const accepted = validateTranslation(source, {
    titleJA: "CFTC、2026年の報告要件を終了する命令",
    factualSummaryJA: "CFTCは、2026年に特定の大口取引者報告要件を終了します。"
  });
  assert.equal(accepted.accepted, true);

  const rejected = validateTranslation(source, {
    titleJA: "報告制度を変更する命令",
    factualSummaryJA: "関連企業の株価には好影響が見込まれます。"
  });
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.warnings.includes("title_dropped_number"));
  assert.ok(rejected.warnings.includes("title_dropped_acronym"));
  assert.ok(rejected.warnings.includes("analysis_language_detected"));

  const inventedQuestion = validateTranslation(source, {
    titleJA: "BISが制度を改正するのか？ 2026 USCIS",
    factualSummaryJA: "公式資料は制度上の手続きを改正する。"
  });
  assert.ok(inventedQuestion.warnings.includes("title_added_question_mark"));

  const inventedCorrection = validateTranslation({
    ...source,
    titleEN: "13 Carcinogens (4-Nitrobiphenyl, etc.)",
    instrumentType: "proposed_rule"
  }, {
    titleJA: "13発がん性物質（4-ニトロビフェニル等）；訂正",
    factualSummaryJA: "OSHAは当該規則案について追加の意見募集期間を設けます。"
  });
  assert.equal(inventedCorrection.accepted, false);
  assert.ok(inventedCorrection.warnings.includes("title_added_correction_marker"));
  const normalizedCorrection = normalizeGeneratedTranslation({
    ...source,
    titleEN: "Acrylonitrile",
    instrumentType: "proposed_rule",
    factualSourceEN: "OSHA reopened the record for an additional 30 days of public comment."
  }, {
    titleJA: "アクリロニトリル；訂正",
    factualSummaryJA: "OSHAはアクリロニトリル基準について追加のコメント期間を提供する。"
  });
  assert.equal(normalizedCorrection.titleJA, "アクリロニトリル");
  assert.equal(normalizedCorrection.factualSummaryJA, "OSHAはアクリロニトリル基準について追加の意見募集期間を設ける。");
  assert.equal(validateTranslation({
    ...source,
    titleEN: "Acrylonitrile",
    instrumentType: "proposed_rule",
    factualSourceEN: "OSHA reopened the record for an additional 30 days of public comment."
  }, normalizedCorrection).accepted, true);

  const identifierSource = {
    ...source,
    titleEN: "USCIS Immigration Fees Required by H.R.1; Correction"
  };
  const missingIdentifiers = validateTranslation(identifierSource, {
    titleJA: "移民手数料に関する文書；訂正",
    factualSummaryJA: "当局は移民手数料に関する規則を訂正します。"
  });
  const repaired = preserveRequiredTitleIdentifiers(identifierSource, missingIdentifiers);
  assert.equal(repaired.accepted, true);
  assert.match(repaired.titleJA, /USCIS/);
  assert.match(repaired.titleJA, /H\.R\.1/);

  const duplicatedCorrection = validateTranslation(identifierSource, {
    titleJA: "USCIS移民手数料をH.R.1により修正；訂正",
    factualSummaryJA: "当局は移民手数料に関する規則を訂正します。"
  });
  assert.ok(duplicatedCorrection.warnings.includes("title_duplicated_correction"));

  const missingCorrectionMarker = validateTranslation(identifierSource, {
    titleJA: "H.R.1で義務付けられたUSCIS移民手数料；修正",
    factualSummaryJA: "当局は移民手数料に関する規則を訂正します。"
  });
  assert.ok(missingCorrectionMarker.warnings.includes("title_dropped_correction_marker"));

  const monthNameSource = {
    ...source,
    titleEN: "HHS Notice for 2027; Correction",
    factualSourceEN: "The final rule appeared in the May 20, 2026, Federal Register."
  };
  const translatedMonth = validateTranslation(monthNameSource, {
    titleJA: "HHS、2027年通知；訂正",
    factualSummaryJA: "最終規則は2026年5月20日の連邦官報に掲載されました。"
  });
  assert.equal(translatedMonth.accepted, true);

  const copiedEnglishTitle = validateTranslation(monthNameSource, {
    titleJA: "Patient Protection and Affordable Care Act, HHS Notice for 2027；訂正",
    factualSummaryJA: "最終規則は2026年5月20日の連邦官報に掲載されました。"
  });
  assert.ok(copiedEnglishTitle.warnings.includes("title_excessive_english"));

  const copiedEnglishSummary = validateTranslation(monthNameSource, {
    titleJA: "HHS、2027年通知；訂正",
    factualSummaryJA: "2026年5月20日のFederal Registerに掲載されたfinal ruleのtypographical errorsを訂正します。"
  });
  assert.ok(copiedEnglishSummary.warnings.includes("summary_excessive_english"));
});

test("immediate translator sends one Responses request and parses structured output and usage", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Bearer /);
    return new Response(JSON.stringify({
      id: "resp_translation",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        titleJA: "CFTC、2026年の報告要件を終了する命令",
        factualSummaryJA: "CFTCは、2026年に特定の大口取引者報告要件を終了します。"
      }) }] }],
      usage: { input_tokens: 120, output_tokens: 40 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await requestOpenAITranslation(translationSourceForEvent(event)!, "secret-for-test", defaultTranslationModel, fetcher);
  assert.equal(calls, 1);
  assert.equal(result.responseID, "resp_translation");
  assert.equal(result.inputTokens, 120);
  assert.equal(result.outputTokens, 40);
});

test("an incomplete OpenAI response reports safe diagnostics without response content", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [{ type: "reasoning", content: [] }],
    usage: { input_tokens: 321, output_tokens: 1_200 }
  }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    requestOpenAITranslation(translationSourceForEvent(event)!, "diagnostic-test-key", defaultTranslationModel, fetcher),
    /status=incomplete reason=max_output_tokens output=reasoning:none input_tokens=321 output_tokens=1200/
  );
});

test("OpenAI quota exhaustion remains distinguishable from an ordinary rate limit", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    error: {
      message: "You exceeded your current quota, please check your plan and billing details.",
      type: "insufficient_quota",
      code: "insufficient_quota"
    }
  }), { status: 429, headers: { "content-type": "application/json" } });

  await assert.rejects(
    requestOpenAITranslation(translationSourceForEvent(event)!, "quota-test-key", defaultTranslationModel, fetcher),
    (error: unknown) => error instanceof OpenAIAPIError
      && error.status === 429
      && error.code === "insufficient_quota"
  );
});

test("public overlay exposes machine translation provenance without changing analysis", () => {
  const row: PolicyTranslationRow = {
    id: "translation", event_id: event.id, source_content_hash: hash, source_language: "en",
    title_ja: "CFTC、2026年の報告要件を終了する命令", title_status: "machine_translated",
    factual_summary_ja: "CFTCは、2026年に特定の報告要件を終了します。", factual_summary_status: "machine_translated",
    provider: "openai", model: defaultTranslationModel, prompt_version: "policy-translation-v1",
    translated_at: "2026-07-22T00:01:00.000Z", validation_warnings_json: "[]"
  };
  const translated = applyPublicTranslation(event, row);
  assert.equal(translated.titleJA, row.title_ja);
  assert.equal(translated.translation?.titleStatus, "machine_translated");
  assert.equal(translated.analysis, event.analysis);

  const falseCorrection = applyPublicTranslation({
    ...event,
    titleEN: "13 Carcinogens (4-Nitrobiphenyl, etc.)",
    instrumentType: "proposed_rule"
  }, {
    ...row,
    title_ja: "13発がん性物質（4-ニトロビフェニル等）；訂正"
  });
  assert.equal(falseCorrection.titleJA, "13発がん性物質（4-ニトロビフェニル等）");
});

test("historical Batch submission cannot call OpenAI without exact count-and-token confirmation", async () => {
  const manifest = {
    id: "33333333-3333-4333-8333-333333333333", status: "prepared",
    cutoff_before: defaultRealtimeCutoff, candidate_count: 12,
    estimated_input_tokens: 12_000, estimated_output_tokens: 3_000,
    estimated_max_cost_usd: 0.001, manifest_object_key: "batch.jsonl",
    openai_input_file_id: null, openai_batch_id: null
  };
  let fetchCalls = 0;
  const statement = {
    bind() { return statement; },
    async first() { return manifest; }
  };
  const env = {
    OPENAI_API_KEY: "test-key",
    OPS: { prepare() { return statement; } },
    CORE: {}, TEMP: {}
  } as unknown as TranslationEnv;
  const fetcher: typeof fetch = async () => { fetchCalls += 1; return new Response(); };
  await assert.rejects(
    submitBatchManifest(env, manifest.id, "yes", fetcher),
    /confirmation text did not match/
  );
  assert.equal(fetchCalls, 0);
  assert.equal(batchConfirmationText(manifest), `SUBMIT BATCH ${manifest.id} ITEMS 12 TOKENS 15000`);
});

// 2026-08-26: 固有名詞だらけの題名が「英語が残りすぎ」で丸ごと捨てられていた。
// 失敗1,545件の最大要因(title_excessive_english 1,065件)がこの形。
test("固有名詞を引き継いだ訳は excessive_english にしない", () => {
  const titleEN = "Bulk Manufacturer of Controlled Substances Application: "
    + "Scottsdale Research Institute SRI Montana Satellite Laboratory";
  const source: TranslationSource = {
    eventID: "e",
    sourceContentHash: hash,
    sourceAvailableAt: "2026-08-25T00:00:00.000Z",
    sourceLanguage: "en",
    titleEN,
    factualSourceEN: "The application concerns a bulk manufacturer registration.",
    agencyCode: "DOJ",
    documentNumber: null,
    instrumentType: null
  };

  // 固有名詞は原文のまま、それ以外は日本語。これは**正しい訳**。
  const good = validateTranslation(source, {
    titleJA: "規制物質の大量製造業者の登録申請：Scottsdale Research Institute SRI Montana Satellite Laboratory",
    factualSummaryJA: "本件は大量製造業者としての登録申請に関するものである。"
  });
  assert.deepEqual(good.warnings, []);
  assert.equal(good.accepted, true);

  // 原文をそのまま返しただけのものは、今までどおり弾く。
  const untranslated = validateTranslation(source, {
    titleJA: titleEN,
    factualSummaryJA: "本件は大量製造業者としての登録申請に関するものである。"
  });
  assert.equal(untranslated.accepted, false);
  assert.ok(untranslated.warnings.includes("title_has_no_japanese_script"));
});

// 2026-08-26: 過去資料を `awaiting_batch` で積むのをやめた。
// 積んだところで Batch は明示確認まで送らない決まりで、354件が動かないまま溜まっていた。
// 自動は新着だけ。過去のは人が押したときだけ訳す。
test("cutoff より古い資料は自動の対象にしない", () => {
  const cutoff = "2026-07-21T15:00:00.000Z";
  assert.equal(translationLane("2026-08-25T00:00:00.000Z", cutoff), "realtime");
  assert.equal(translationLane("2026-07-01T00:00:00.000Z", cutoff), "batch");
  // 人が指名したものは、古くても即時レーンへ乗る。
  assert.equal(translationLane("2026-07-01T00:00:00.000Z", cutoff, true), "manual_priority");
});
