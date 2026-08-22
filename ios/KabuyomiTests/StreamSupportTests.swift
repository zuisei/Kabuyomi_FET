import XCTest
@testable import Kabuyomi

/// v2 IA Phase 4(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 4」節)の導出ロジック。
/// 画面を起動せずに、ストリームの並び・提案質問・宛先の既定値・
/// 「チップは載せるだけで送らない」という契約を固定する。
final class StreamSupportTests: XCTestCase {
    private func date(_ seconds: Double) -> Date {
        Date(timeIntervalSince1970: seconds)
    }

    private func metric(_ logicalName: String, yoyPercent: Double?) -> MetricPayload {
        MetricPayload(
            logicalName: logicalName,
            tagUsed: logicalName,
            value: 100,
            unit: "USD",
            periodEnd: "2026-03-28",
            comparisonValue: 90,
            yoyPercent: yoyPercent
        )
    }

    private func card(
        ticker: String,
        companyName: String? = nil,
        formType: String = "10-Q",
        filedAt: Date,
        verdict: String = "増収でした。詳細は本文。",
        metrics: [MetricPayload] = [],
        isPlaceholder: Bool = false
    ) -> WatchlistCard {
        WatchlistCard(
            filingKey: isPlaceholder ? "" : "v1:\(ticker):\(ticker)-26-000001",
            ticker: ticker,
            companyName: companyName ?? "\(ticker) Inc.",
            formType: isPlaceholder ? "" : formType,
            filedAt: filedAt,
            verdict: verdict,
            metrics: metrics,
            isPlaceholder: isPlaceholder
        )
    }

    private func message(
        _ role: String,
        _ content: String,
        at seconds: Double,
        sources: [LocalMessageSourceRef] = []
    ) -> LocalChatMessage {
        LocalChatMessage(
            id: UUID(),
            role: role,
            content: content,
            createdAt: date(seconds),
            modelName: "",
            sources: sources
        )
    }

    private func record(
        ticker: String,
        filingKey: String,
        messages: [LocalChatMessage]
    ) -> LocalCompanyRecord {
        LocalCompanyRecord(
            company: TestFixtures.companyPayload(ticker: ticker, filingKey: filingKey),
            chatHistory: messages
        )
    }

    private func minimalCompany(
        ticker: String = "AAPL",
        formType: String,
        metrics: [MetricPayload]
    ) -> CompanyPayload {
        CompanyPayload(
            filingKey: "v1:\(ticker):1",
            ticker: ticker,
            companyName: "\(ticker) Inc.",
            cik: "0000000001",
            formType: formType,
            filedAt: "2026-05-01",
            periodOfReport: "2026-03-28",
            primaryDocumentUrl: "https://www.sec.gov/\(ticker).htm",
            companyWebsiteUrl: nil,
            summary: SummaryPayload(verdict: "", highlights: [], changes: []),
            metrics: metrics,
            historicalOverview: nil,
            sourceChunks: [],
            lastUpdatedAt: "2026-05-01T00:00:00.000Z"
        )
    }

    // MARK: - 宛先(アスクバーの会社チップ)

    /// 既定値の解決順: 最後に開いた会社 → 直近の保存済み → なし。
    func testAskContextPrefersTheLastOpenedCompany() {
        let context = streamAskContext(
            lastOpenedTicker: "msft",
            saved: [card(ticker: "AAPL", filedAt: date(1_770_000_000))],
            recent: [card(ticker: "MSFT", companyName: "Microsoft Corporation", filedAt: date(1_770_000_000))]
        )

        XCTAssertEqual(context?.ticker, "MSFT")
        XCTAssertEqual(context?.companyName, "Microsoft Corporation")
        XCTAssertEqual(context?.displayName, "Microsoft Corporation")
    }

    func testAskContextFallsBackToTheNewestSavedCompany() {
        let context = streamAskContext(
            lastOpenedTicker: nil,
            saved: [
                card(ticker: "NVDA", companyName: "NVIDIA Corporation", filedAt: date(1_770_000_000)),
                card(ticker: "AAPL", filedAt: date(1_780_000_000))
            ],
            recent: []
        )

        XCTAssertEqual(context?.ticker, "NVDA")
    }

    /// 1社も触っていない人に宛先を作らない。
    /// スターター企業を勝手に宛先に据えると、本人が選んでいない会社へクレジットを使う。
    func testAskContextIsAbsentWithoutAnyCompany() {
        XCTAssertNil(streamAskContext(lastOpenedTicker: nil, saved: [], recent: []))
        XCTAssertNil(streamAskContext(lastOpenedTicker: "   ", saved: [], recent: []))
    }

    /// 会社名がまだ ticker のままのカードでは、チップに ticker を1回だけ出す。
    func testAskContextSuppressesACompanyNameThatIsJustTheTicker() {
        let context = streamAskContext(
            lastOpenedTicker: "SOFI",
            saved: [card(ticker: "SOFI", companyName: "SOFI", filedAt: .distantPast, isPlaceholder: true)],
            recent: []
        )

        XCTAssertEqual(context?.companyName, "")
        XCTAssertEqual(context?.displayName, "SOFI")
    }

    /// 追跡していない会社を最後に開いていても、宛先としては成立する。
    /// TSLA はスターター表に正式表記があるので、裸の ticker ではなく
    /// 「Tesla, Inc.」を名乗れる(2026-08-22 の表記オーバーライドで改善)。
    /// 表に無い銘柄は従来どおり ticker のまま。
    func testAskContextKeepsAnUntrackedLastOpenedCompany() {
        let context = streamAskContext(lastOpenedTicker: "tsla", saved: [], recent: [])
        XCTAssertEqual(context?.ticker, "TSLA")
        XCTAssertEqual(context?.displayName, "Tesla, Inc.")

        let uncurated = streamAskContext(lastOpenedTicker: "sofi", saved: [], recent: [])
        XCTAssertEqual(uncurated?.ticker, "SOFI")
        XCTAssertEqual(uncurated?.displayName, "SOFI")
    }

    // MARK: - 提案質問

    func testSuggestedQuestionsFollowTheMetricsAndTheFormType() {
        XCTAssertEqual(
            streamSuggestedQuestions(
                formType: "10-Q",
                metrics: [metric("revenue", yoyPercent: 12), metric("operatingIncome", yoyPercent: 4)]
            ),
            ["今回の最大変化は？", "売上を伸ばした要因は？", "利益率は改善？"]
        )

        XCTAssertEqual(
            streamSuggestedQuestions(
                formType: "10-K",
                metrics: [metric("revenue", yoyPercent: -3), metric("operatingIncome", yoyPercent: -8)]
            ),
            ["今回の最大変化は？", "売上が弱かった要因は？", "利益率が悪化した理由は？"]
        )
    }

    func testSuggestedQuestionsFallBackToThePeriodComparison() {
        XCTAssertEqual(
            streamSuggestedQuestions(formType: "10-Q", metrics: []),
            ["今回の最大変化は？", "前回四半期との差は？"]
        )
        XCTAssertEqual(
            streamSuggestedQuestions(formType: "10-K", metrics: []),
            ["今回の最大変化は？", "前回決算との違いは？"]
        )
    }

    func testSuggestedQuestionsIgnoreMetricsWithoutAYoY() {
        XCTAssertEqual(
            streamSuggestedQuestions(formType: "10-K", metrics: [metric("revenue", yoyPercent: nil)]),
            ["今回の最大変化は？", "前回決算との違いは？"]
        )
    }

    /// ストリームの提案は、会社ワークスペースが同じ会社に出す提案の**部分集合**であること。
    /// 文言が片方だけ動いたらここで落ちる。
    ///
    /// 比較先が2つあるのは、末尾の「前回との差」だけが
    /// `buildHistoricalQuestions` 由来だから(ワークスペースでは
    /// 件数が足りないときにだけ表に出る)。それ以外は `buildSuggestedQuestions` と同じ。
    func testSuggestedQuestionsAreASubsetOfTheWorkspaceSuggestions() {
        let cases: [(String, [MetricPayload])] = [
            ("10-Q", [metric("revenue", yoyPercent: 12), metric("operatingIncome", yoyPercent: 4)]),
            ("10-Q", [metric("revenue", yoyPercent: -12), metric("operatingIncome", yoyPercent: -4)]),
            ("10-K", [metric("revenue", yoyPercent: 1)]),
            ("10-K", []),
            ("10-Q", [])
        ]

        for (formType, metrics) in cases {
            let company = minimalCompany(formType: formType, metrics: metrics)
            let workspace = Set(buildSuggestedQuestions(for: company))
                .union(buildHistoricalQuestions(for: company))
            let stream = streamSuggestedQuestions(formType: formType, metrics: metrics)
            XCTAssertFalse(stream.isEmpty)
            for question in stream {
                XCTAssertTrue(
                    workspace.contains(question),
                    "「\(question)」(\(formType))がワークスペースの提案に無い: \(workspace)"
                )
            }
        }

        // 指標が無い会社では末尾が「前回との差」になり、
        // その文字列はワークスペースの期間比較の先頭と一致する。
        for formType in ["10-K", "10-Q"] {
            let company = minimalCompany(formType: formType, metrics: [])
            XCTAssertEqual(
                streamSuggestedQuestions(formType: formType, metrics: []).last,
                buildHistoricalQuestions(for: company).first
            )
        }
    }

    // MARK: - 資料が出たカード

    func testFilingEventsCarryTheHeadlineUnreadStateAndSuggestions() {
        let events = streamFilingEvents(
            saved: [
                card(
                    ticker: "AAPL",
                    companyName: "Apple Inc.",
                    filedAt: date(1_770_000_000),
                    metrics: [metric("revenue", yoyPercent: 16.6)]
                )
            ],
            recent: [card(ticker: "MSFT", filedAt: date(1_760_000_000))],
            lastOpenedAt: ["AAPL": date(1_769_000_000), "MSFT": date(1_790_000_000)]
        )

        XCTAssertEqual(events.map(\.ticker), ["AAPL", "MSFT"])
        XCTAssertEqual(events[0].headline, "Apple Inc. の 10-Q が出ました")
        XCTAssertTrue(events[0].isUnread)
        XCTAssertFalse(events[1].isUnread)
        XCTAssertEqual(events[0].verdictLine, "増収でした。")
        XCTAssertEqual(
            events[0].suggestedQuestions,
            ["今回の最大変化は？", "売上を伸ばした要因は？", "前回四半期との差は？"]
        )
    }

    /// 社名がまだ ticker のままの会社では、見出しの主語に ticker を1回だけ出す。
    func testFilingEventHeadlineFallsBackToTheTicker() {
        let event = StreamFilingEventCard(
            ticker: "SOFI",
            companyName: "SOFI",
            formType: "10-K",
            filedAt: date(1_770_000_000),
            filingKey: "v1:SOFI:1",
            verdictLine: "増収でした。",
            isUnread: false,
            revenueDelta: nil,
            suggestedQuestions: []
        )

        XCTAssertEqual(event.headline, "SOFI の 10-K が出ました")
    }

    /// まだ資料を取れていない会社は「出ました」ではない(Phase 3 の新着と同じ判断)。
    func testFilingEventsDropPlaceholders() {
        let events = streamFilingEvents(
            saved: [card(ticker: "SOFI", filedAt: .distantPast, isPlaceholder: true)],
            recent: [],
            lastOpenedAt: [:]
        )

        XCTAssertTrue(events.isEmpty)
    }

    /// Phase 5: 資料イベントカードは会社ヘッダー行に売上 YoY を1本だけ添える。
    /// サマリーの板行は3本並べるが、カードは読み面なので本文の前に3本置かない。
    func testFilingEventsCarryTheRevenuePillOnlyAndOmitItWhenRevenueIsNotCached() {
        let withRevenue = streamFilingEvents(
            saved: [
                card(
                    ticker: "AAPL",
                    filedAt: date(1_770_000_000),
                    metrics: [metric("revenue", yoyPercent: 16.6), metric("netIncome", yoyPercent: 8.0)]
                )
            ],
            recent: [],
            lastOpenedAt: [:]
        )
        XCTAssertEqual(withRevenue[0].revenueDelta?.text, "+16.6%")

        let withoutRevenue = streamFilingEvents(
            saved: [
                card(
                    ticker: "SNAP",
                    filedAt: date(1_770_000_000),
                    metrics: [metric("netIncome", yoyPercent: 8.0)]
                )
            ],
            recent: [],
            lastOpenedAt: [:]
        )
        // 売上が無いからといって純利益に差し替えない。カードごとに違う指標が出ると比べられない。
        XCTAssertNil(withoutRevenue[0].revenueDelta)
    }

    // MARK: - ストリームの並び

    private func answerEntry(
        id: String,
        ticker: String,
        latestActivity: Date
    ) -> ResearchArchiveEntry {
        ResearchArchiveEntry(
            id: id,
            ticker: ticker,
            companyName: "\(ticker) Inc.",
            filingKey: "v1:\(ticker):1",
            formType: "10-Q",
            filedAt: "2026-05-01",
            question: "質問 \(id)",
            answerPreview: "回答です。",
            answerText: "回答です。",
            sourceChips: [],
            answerCount: 1,
            askedAt: latestActivity,
            latestActivity: latestActivity
        )
    }

    private func group(_ entries: [ResearchArchiveEntry]) -> ResearchArchiveGroup {
        ResearchArchiveGroup(
            ticker: entries[0].ticker,
            companyName: entries[0].companyName,
            latestActivity: entries.map(\.latestActivity).max() ?? .distantPast,
            entries: entries
        )
    }

    private func event(ticker: String, filedAt: Date) -> StreamFilingEventCard {
        StreamFilingEventCard(
            ticker: ticker,
            companyName: "\(ticker) Inc.",
            formType: "10-Q",
            filedAt: filedAt,
            filingKey: "v1:\(ticker):1",
            verdictLine: "増収でした。",
            isUnread: false,
            revenueDelta: nil,
            suggestedQuestions: []
        )
    }

    func testStreamInterleavesAnswersAndFilingEventsNewestFirst() {
        let items = streamItems(
            archiveGroups: [
                group([
                    answerEntry(id: "a2", ticker: "AAPL", latestActivity: date(1_780_000_000)),
                    answerEntry(id: "a1", ticker: "AAPL", latestActivity: date(1_760_000_000))
                ])
            ],
            filingEvents: [
                event(ticker: "MSFT", filedAt: date(1_790_000_000)),
                event(ticker: "NVDA", filedAt: date(1_770_000_000))
            ]
        )

        XCTAssertEqual(
            items.map(\.id),
            ["filing:v1:MSFT:1", "answer:a2", "filing:v1:NVDA:1", "answer:a1"]
        )
    }

    /// 同時刻は決定論的に並ぶ。自分の質問を、受け身の出来事より先に置く。
    func testStreamBreaksTiesByKindThenIdentity() {
        let sameMoment = date(1_770_000_000)
        let items = streamItems(
            archiveGroups: [
                group([
                    answerEntry(id: "b", ticker: "AAPL", latestActivity: sameMoment),
                    answerEntry(id: "a", ticker: "AAPL", latestActivity: sameMoment)
                ])
            ],
            filingEvents: [
                event(ticker: "ZZZZ", filedAt: sameMoment),
                event(ticker: "MSFT", filedAt: sameMoment)
            ]
        )

        XCTAssertEqual(
            items.map(\.id),
            ["answer:a", "answer:b", "filing:v1:MSFT:1", "filing:v1:ZZZZ:1"]
        )
    }

    /// 上限は回答にだけ効く。質問を大量に持っている人ほど
    /// 「資料が出た」が窓の外へ押し出される、という壊れ方をさせない。
    func testStreamCapsAnswersButKeepsEveryFilingEvent() {
        let entries = (0..<10).map { index in
            answerEntry(
                id: String(format: "a%02d", index),
                ticker: "AAPL",
                latestActivity: date(1_790_000_000 + Double(index))
            )
        }

        let items = streamItems(
            archiveGroups: [group(entries)],
            filingEvents: [event(ticker: "MSFT", filedAt: date(1_700_000_000))],
            answerLimit: 3
        )

        let answerIds = items.compactMap { item -> String? in
            if case .answer(let entry) = item { return entry.id }
            return nil
        }
        XCTAssertEqual(answerIds, ["a09", "a08", "a07"])
        XCTAssertTrue(items.contains { if case .filingEvent = $0 { return true } else { return false } })
    }

    func testStreamIsEmptyWithoutAnswersOrEvents() {
        XCTAssertTrue(streamItems(archiveGroups: [], filingEvents: []).isEmpty)
    }

    // MARK: - 回答カードの中身

    /// 回答カードは会社ドキュメントを引き当て直さずに描けるだけの情報を持つ。
    func testArchiveEntriesCarryTheCompanyAnswerBodyAndSourceChips() {
        let source = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: "md1",
            sourceKind: .secFiling,
            sourceLabelSnapshot: "Item 7",
            excerpt: "Services revenue increased year over year.",
            sourceUrl: nil
        )

        let groups = researchArchiveGroups(records: [
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:1",
                messages: [
                    message("user", "売上の要因は？", at: 1_770_000_000),
                    message(
                        "assistant",
                        "サービスが伸びました。詳細は本文にあります。",
                        at: 1_770_000_060,
                        sources: [source]
                    )
                ]
            )
        ])

        let entry = groups[0].entries[0]
        XCTAssertEqual(entry.ticker, "AAPL")
        XCTAssertEqual(entry.companyName, "AAPL Holdings")
        XCTAssertEqual(entry.answerText, "サービスが伸びました。詳細は本文にあります。")
        XCTAssertEqual(entry.answerPreview, "サービスが伸びました。")
        XCTAssertEqual(entry.sourceChips.count, 1)
        XCTAssertEqual(entry.sourceChips[0].source, source)
    }

    func testArchiveEntriesCarryNoChipsWithoutAnAnswer() {
        let groups = researchArchiveGroups(records: [
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:1",
                messages: [message("user", "売上の要因は？", at: 1_770_000_000)]
            )
        ])

        let entry = groups[0].entries[0]
        XCTAssertNil(entry.answerText)
        XCTAssertTrue(entry.sourceChips.isEmpty)
    }

    // MARK: - チップは載せるだけ、送らない

    /// 提案質問チップに送信への道が無いこと。
    /// `streamSuggestedQuestionIntent` は `.submit` を返せない。
    func testSuggestedQuestionChipsOnlyEverPrefill() {
        let context = StreamAskContext(ticker: "AAPL", companyName: "Apple Inc.")

        for question in streamExampleQuestions + ["今回の最大変化は？", "  前後に空白  "] {
            let intent = streamSuggestedQuestionIntent(question: question, context: context)
            guard case .prefill(let prefilled, let prefilledContext)? = intent else {
                return XCTFail("チップから .submit が生まれた: \(String(describing: intent))")
            }
            XCTAssertEqual(prefilled, question.trimmingCharacters(in: .whitespacesAndNewlines))
            XCTAssertEqual(prefilledContext, context)
        }
    }

    func testSuggestedQuestionChipsIgnoreEmptyText() {
        XCTAssertNil(streamSuggestedQuestionIntent(question: "   ", context: nil))
    }

    /// 宛先がまだ無くても、チップは入力欄に載る(会社は後から選べる)。
    func testSuggestedQuestionChipsPrefillWithoutACompany() {
        guard case .prefill(_, let context)? = streamSuggestedQuestionIntent(
            question: streamExampleQuestions[0],
            context: nil
        ) else {
            return XCTFail("チップが prefill を返さなかった")
        }
        XCTAssertNil(context)
    }

    func testSendIntentRequiresTextACompanyAndAnEnabledComposer() {
        let context = StreamAskContext(ticker: "AAPL", companyName: "Apple Inc.")

        XCTAssertNil(streamSendIntent(draft: "  ", context: context, disabledReason: nil))
        XCTAssertNil(streamSendIntent(draft: "売上は？", context: nil, disabledReason: nil))
        XCTAssertNil(streamSendIntent(draft: "売上は？", context: context, disabledReason: "残高不足"))

        XCTAssertEqual(
            streamSendIntent(draft: "  売上は？  ", context: context, disabledReason: nil),
            .submit(question: "売上は？", context: context)
        )
    }

    // MARK: - 送信前の判定(2つのコンポーザで共有)

    /// 文言と優先順位を固定する。`"残高不足"` は呼び出し側が分岐に使っている。
    func testComposerDisabledReasonPinsTheStringsAndTheirPrecedence() {
        XCTAssertNil(
            redesignComposerDisabledReason(
                isSending: false,
                hasChatCreditAvailable: true,
                authenticatedCreditActionsAvailable: true,
                chatEnabled: true
            )
        )
        XCTAssertNil(
            redesignComposerDisabledReason(
                isSending: false,
                hasChatCreditAvailable: true,
                authenticatedCreditActionsAvailable: true,
                chatEnabled: nil
            )
        )
        XCTAssertEqual(
            redesignComposerDisabledReason(
                isSending: true,
                hasChatCreditAvailable: false,
                authenticatedCreditActionsAvailable: false,
                chatEnabled: false
            ),
            "回答を作成中です"
        )
        XCTAssertEqual(
            redesignComposerDisabledReason(
                isSending: false,
                hasChatCreditAvailable: false,
                authenticatedCreditActionsAvailable: false,
                chatEnabled: false
            ),
            "残高不足"
        )
        XCTAssertEqual(
            redesignComposerDisabledReason(
                isSending: false,
                hasChatCreditAvailable: true,
                authenticatedCreditActionsAvailable: false,
                chatEnabled: false
            ),
            "端末認証を確認中"
        )
        XCTAssertEqual(
            redesignComposerDisabledReason(
                isSending: false,
                hasChatCreditAvailable: true,
                authenticatedCreditActionsAvailable: true,
                chatEnabled: false
            ),
            "質問機能を一時停止中"
        )
    }

    func testAskPreparationOrdersEmptyBlockedConsentAndReady() {
        XCTAssertEqual(
            redesignAskPreparation(rawQuestion: "   ", disabledReason: nil, aiConsentGranted: true),
            .empty
        )
        // 空文字は塞がれていても何も起きない。理由のダイアログを空打ちで出さない。
        XCTAssertEqual(
            redesignAskPreparation(rawQuestion: "", disabledReason: "残高不足", aiConsentGranted: true),
            .empty
        )
        XCTAssertEqual(
            redesignAskPreparation(rawQuestion: "売上は？", disabledReason: "残高不足", aiConsentGranted: true),
            .blocked(reason: "残高不足")
        )
        // 同意が無くても、塞がれている理由が先に立つ。
        XCTAssertEqual(
            redesignAskPreparation(rawQuestion: "売上は？", disabledReason: "残高不足", aiConsentGranted: false),
            .blocked(reason: "残高不足")
        )
        XCTAssertEqual(
            redesignAskPreparation(rawQuestion: "  売上は？ ", disabledReason: nil, aiConsentGranted: false),
            .needsConsent(question: "売上は？")
        )
        XCTAssertEqual(
            redesignAskPreparation(rawQuestion: "  売上は？ ", disabledReason: nil, aiConsentGranted: true),
            .ready(question: "売上は？")
        )
    }

    // MARK: - 残高表示

    func testCreditBalanceTextIsTheCompactForm() {
        XCTAssertEqual(streamCreditBalanceText(totalRemaining: 12), "残り 12")
        XCTAssertEqual(streamCreditBalanceText(totalRemaining: 0), "残り 0")
        XCTAssertEqual(streamCreditBalanceText(totalRemaining: nil), "残高を確認")
    }

    // MARK: - 空のストリームの例示

    func testExampleQuestionsAreThreeColloquialPrompts() {
        XCTAssertEqual(streamExampleQuestions.count, 3)
        XCTAssertEqual(Set(streamExampleQuestions).count, 3)
        for question in streamExampleQuestions {
            XCTAssertFalse(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    // 2026-08-22 実機レビュー: 同じ3チップが全イベントカードに繰り返され、
    // 画面の大半がチップになっていた。提案は最新の1枚だけが持つ。
    func testOnlyNewestFilingEventCarriesSuggestions() {
        let events = streamFilingEvents(
            saved: [
                card(ticker: "NVDA", filedAt: date(1_780_000_000), metrics: [metric("revenue", yoyPercent: 85.2)]),
                card(ticker: "AAPL", filedAt: date(1_770_000_000), metrics: [metric("revenue", yoyPercent: 16.6)])
            ],
            recent: [],
            lastOpenedAt: [:]
        )

        XCTAssertEqual(events.map(\.ticker), ["NVDA", "AAPL"])
        XCTAssertFalse(events[0].suggestedQuestions.isEmpty)
        XCTAssertTrue(events[1].suggestedQuestions.isEmpty)
    }
}
