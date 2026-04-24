import XCTest
@testable import Kabuyomi

final class ConversationPromptTests: XCTestCase {
    func testResolveConversationIdleStateTreatsPrefilledQuestionAsDraft() {
        XCTAssertEqual(resolveConversationIdleState(draftQuestion: "   "), .intro)
        XCTAssertEqual(
            resolveConversationIdleState(draftQuestion: " 利益率は改善した？ "),
            .drafted(question: "利益率は改善した？")
        )
    }

    func testConsentDismissalRestoresPendingDraftWhenConsentIsNotGranted() {
        XCTAssertEqual(
            restoreDraftAfterConsentDismissal(
                currentDraft: "   ",
                pendingSubmission: " 売上高は？ "
            ),
            "売上高は？"
        )
    }

    func testConsentDismissalDoesNotOverwriteNewDraft() {
        XCTAssertNil(
            restoreDraftAfterConsentDismissal(
                currentDraft: "利益率は？",
                pendingSubmission: "売上高は？"
            )
        )
    }

    func testBuildFollowUpQuestionsFallsBackToHistoricalForPeerComparison() {
        let company = TestFixtures.companyPayload()

        let suggestions = buildFollowUpQuestions(
            for: company,
            precedingUserPrompt: "MSFT と比較するとどう？"
        )

        XCTAssertEqual(suggestions.first, "前回決算との違いは？")
        XCTAssertTrue(suggestions.contains("この3年の利益率推移は？"))
    }

    func testStructureAssistantMessageKeepsBoilerplateOutOfConclusion() {
        let structure = structureAssistantMessage(
            """
            売上高は 451.8億ドル で、前年同期比 15.9%増 です。 \
            A detailed discussion of these and other risks and uncertainties that could cause actual results and events to differ materially from such forward-looking statements is included elsewhere. \
            この決算資料だけでは、これ以上の切り分けは難しいです。
            """
        )

        XCTAssertEqual(structure.conclusion, "売上高は 451.8億ドル で、前年同期比 15.9%増 です。")
        XCTAssertFalse(structure.evidence.contains { $0.contains("A detailed discussion") })
        XCTAssertTrue(structure.limitations.contains("この決算資料だけでは、これ以上の切り分けは難しいです。"))
    }

    func testLocalizedAssistantDisplayTextStripsLongEnglishBoilerplateWhenJapaneseExists() {
        let text = localizedAssistantDisplayText(
            "売上高は 451.8億ドル で、前年同期比 15.9%増 です。 A detailed discussion of these and other risks and uncertainties that could cause actual results and events to differ materially from such forward-looking statements is included elsewhere."
        )

        XCTAssertEqual(text, "売上高は 451.8億ドル で、前年同期比 15.9%増 です。")
    }

    func testLocalizedAssistantDisplayTextKeepsEnglishCompanyNameBeforeJapanesePredicate() {
        let text = localizedAssistantDisplayText(
            "American Airlines Group Inc. は、航空輸送業を営む企業です。旅客や貨物の輸送サービスを提供しています。"
        )

        XCTAssertEqual(
            text,
            "American Airlines Group Inc. は、航空輸送業を営む企業です。旅客や貨物の輸送サービスを提供しています。"
        )
    }

    func testStructureAssistantMessageKeepsEnumeratedReasonsInConclusion() {
        let structure = structureAssistantMessage(
            """
            NVIDIAは主に2つの事業で稼いでいます。\
            1つ目はコンピューティングとネットワーク事業で、AIや加速コンピューティングという新しい技術への移行に伴い、データセンター向けの計算機やネットワーク機器の需要が急増しています。\
            2つ目はグラフィックス事業で、Blackwellという最新の設計に基づいた商品の販売で収益を上げています。\
            特にデータセンター向けの事業が伸びた結果、2026年度の営業利益は1,301億4,100万ドルとなり、前年比で57％増加しました。
            """
        )

        XCTAssertEqual(
            structure.conclusion,
            """
            NVIDIAは主に2つの事業で稼いでいます。 1つ目はコンピューティングとネットワーク事業で、AIや加速コンピューティングという新しい技術への移行に伴い、データセンター向けの計算機やネットワーク機器の需要が急増しています。 2つ目はグラフィックス事業で、Blackwellという最新の設計に基づいた商品の販売で収益を上げています。
            """
        )
        XCTAssertEqual(
            structure.evidence,
            ["特にデータセンター向けの事業が伸びた結果、2026年度の営業利益は1,301億4,100万ドルとなり、前年比で57％増加しました。"]
        )
    }

    func testStructureAssistantMessageDoesNotTreatEveryTadashiAsLimitation() {
        let structure = structureAssistantMessage(
            """
            売上高は 1,437.6億ドル で、前年同期比 15.7%増 です。\
            ただし、サービスも伸びています。
            """
        )

        XCTAssertEqual(
            structure.conclusion,
            "売上高は 1,437.6億ドル で、前年同期比 15.7%増 です。 ただし、サービスも伸びています。"
        )
        XCTAssertTrue(structure.limitations.isEmpty)
    }

    func testUnavailableMessageRequiresMoreThanPartialCaveat() {
        XCTAssertTrue(isUnavailableMessage("この決算資料の範囲では確認できません。"))
        XCTAssertFalse(
            isUnavailableMessage(
                "売上高は 1,437.6億ドル で、前年同期比 15.7%増 です。どの要因が一番効いたかは追加情報があると絞れます。"
            )
        )
    }

    func testPendingAssistantViewStateStartsWithThinking() {
        let submittedAt = Date()

        let state = buildPendingAssistantViewState(
            question: "前回決算との違いは？",
            submittedAt: submittedAt,
            now: submittedAt.addingTimeInterval(0.4),
            formType: "10-K"
        )

        XCTAssertEqual(state.badge, "Thinking")
        XCTAssertEqual(state.title, "質問の軸を整理しています")
    }

    func testPendingAssistantViewStateShowsHistoricalSearchingForQuarterlyComparison() {
        let submittedAt = Date()

        let state = buildPendingAssistantViewState(
            question: "この3年の同四半期で利益率は改善した？",
            submittedAt: submittedAt,
            now: submittedAt.addingTimeInterval(1.8),
            formType: "10-Q"
        )

        XCTAssertEqual(state.badge, "Searching")
        XCTAssertEqual(state.title, "比較に必要な提出資料を探しています")
        XCTAssertEqual(state.detail, "同四半期ベースで必要な過去年だけ補完しています。")
    }

    func testShouldDisplayPendingOptimisticMessageWhileAwaitingPersistence() {
        let submittedAt = Date()
        let chatHistory = [
            LocalChatMessage(
                id: UUID(),
                role: "user",
                content: "前回決算との違いは？",
                createdAt: submittedAt.addingTimeInterval(-30),
                modelName: "local",
                sources: []
            )
        ]

        XCTAssertTrue(
            shouldDisplayPendingOptimisticMessage(
                chatHistory: chatHistory,
                pendingChat: PendingChatState(
                    ticker: "AAPL",
                    question: "今回の一番大きい変化は？",
                    submittedAt: submittedAt
                )
            )
        )
    }

    func testShouldHidePendingOptimisticMessageAfterCurrentUserMessageIsPersisted() {
        let submittedAt = Date()
        let chatHistory = [
            LocalChatMessage(
                id: UUID(),
                role: "user",
                content: "今回の一番大きい変化は？",
                createdAt: submittedAt.addingTimeInterval(0.2),
                modelName: "local",
                sources: []
            ),
            LocalChatMessage(
                id: UUID(),
                role: "assistant",
                content: "売上高の伸びが大きいです。",
                createdAt: submittedAt.addingTimeInterval(0.21),
                modelName: "",
                sources: []
            )
        ]

        XCTAssertFalse(
            shouldDisplayPendingOptimisticMessage(
                chatHistory: chatHistory,
                pendingChat: PendingChatState(
                    ticker: "AAPL",
                    question: "今回の一番大きい変化は？",
                    submittedAt: submittedAt
                )
            )
        )
    }

    func testShouldDisplayPendingAssistantStatusWhileAwaitingResponsePersistence() {
        let submittedAt = Date()
        let chatHistory = [
            LocalChatMessage(
                id: UUID(),
                role: "user",
                content: "今回の一番大きい変化は？",
                createdAt: submittedAt.addingTimeInterval(0.1),
                modelName: "local",
                sources: []
            )
        ]

        XCTAssertTrue(
            shouldDisplayPendingAssistantStatus(
                chatHistory: chatHistory,
                pendingChat: PendingChatState(
                    ticker: "AAPL",
                    question: "今回の一番大きい変化は？",
                    submittedAt: submittedAt
                )
            )
        )
    }

    func testShouldHidePendingAssistantStatusAfterAssistantMessageIsPersisted() {
        let submittedAt = Date()
        let chatHistory = [
            LocalChatMessage(
                id: UUID(),
                role: "user",
                content: "今回の一番大きい変化は？",
                createdAt: submittedAt.addingTimeInterval(0.2),
                modelName: "local",
                sources: []
            ),
            LocalChatMessage(
                id: UUID(),
                role: "assistant",
                content: "売上高の伸びが大きいです。",
                createdAt: submittedAt.addingTimeInterval(0.21),
                modelName: "",
                sources: []
            )
        ]

        XCTAssertFalse(
            shouldDisplayPendingAssistantStatus(
                chatHistory: chatHistory,
                pendingChat: PendingChatState(
                    ticker: "AAPL",
                    question: "今回の一番大きい変化は？",
                    submittedAt: submittedAt
                )
            )
        )
    }

    func testSummarySignalSegmentWidthsStayWithinTotalWidthAfterSpacing() {
        let widths = summarySignalSegmentWidths(
            totalWidth: 240,
            counts: [4, 3, 2]
        )

        XCTAssertEqual(widths.count, 3)
        XCTAssertEqual(widths.reduce(0, +) + 12, 240, accuracy: 0.001)
    }

    func testSummarySignalSegmentWidthsKeepZeroCountSegmentVisibleWithoutOverflow() {
        let widths = summarySignalSegmentWidths(
            totalWidth: 180,
            counts: [3, 0, 1]
        )

        XCTAssertEqual(widths.count, 3)
        XCTAssertGreaterThan(widths[1], 0)
        XCTAssertEqual(widths.reduce(0, +) + 12, 180, accuracy: 0.001)
    }

    func testHistoricalBoardCopyDoesNotClaimThreeYearsWhenOnlyTwoPeriodsExist() {
        let copy = historicalBoardCopy(
            comparisonBasis: "quarterly",
            requestedYears: 3,
            availablePeriodCount: 2,
            singleSeriesLabel: "EPS（Basic）"
        )

        XCTAssertEqual(copy.eyebrow, "2期")
        XCTAssertEqual(copy.title, "EPS（Basic）の取得済み2期比較")
        XCTAssertEqual(copy.subtitle, "同四半期。3年分のうち取得済み2期の推移を表示")
        XCTAssertEqual(copy.note, "履歴比較は同四半期ベースです。3年分が揃うまでは取得済み期間だけ表示します。")
    }

    func testHistoricalBoardCopyKeepsThreeYearTitleWhenPeriodsAreComplete() {
        let copy = historicalBoardCopy(
            comparisonBasis: "annual",
            requestedYears: 3,
            availablePeriodCount: 3,
            singleSeriesLabel: nil
        )

        XCTAssertEqual(copy.eyebrow, "3年")
        XCTAssertEqual(copy.title, "3年の年次比較")
        XCTAssertEqual(copy.subtitle, "年次で 3 年分の推移を比較")
        XCTAssertEqual(copy.note, "履歴比較は年次ベースです。")
    }

    func testHistoricalChartScaleIncludesZeroForPositiveAndNegativeValues() {
        let scale = historicalChartScale(values: [-3, 7])

        XCTAssertEqual(scale.minValue, -3)
        XCTAssertEqual(scale.maxValue, 7)
        XCTAssertEqual(historicalChartY(value: 0, scale: scale, height: 100), 70, accuracy: 0.001)
    }

    func testHistoricalMetricSummaryTextNamesVisibleMetricOutsideScrollableTable() {
        let company = TestFixtures.companyPayload()
        let summary = historicalMetricSummaryText(for: company.historicalOverview?.series ?? [])

        XCTAssertEqual(summary, "表示指標: 売上高")
    }

    func testFormattedMetricValueGroupsLargeRevenueLikeWorkerAnswers() {
        let metric = MetricPayload(
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143_756_000_000,
            unit: "USD",
            periodEnd: "2026-03-28",
            comparisonValue: 124_300_000_000,
            yoyPercent: 15.7
        )

        XCTAssertEqual(formattedMetricValue(metric), "1,437.6億ドル")
        XCTAssertEqual(
            formattedMetricValue(124_300_000_000, logicalName: metric.logicalName, unit: metric.unit),
            "1,243億ドル"
        )
    }

    func testFormattedMetricValueKeepsUnknownCurrencyUnitInsteadOfCallingItDollars() {
        XCTAssertEqual(
            formattedMetricValue(1_234_567, logicalName: "revenue", unit: "JPY"),
            "1,234,567 JPY"
        )
    }

    func testMetricYoYDisplayUsesLossLanguageWhenOperatingLossShrinks() {
        let metric = MetricPayload(
            logicalName: "operatingIncome",
            tagUsed: "us-gaap:OperatingIncomeLoss",
            value: -41_000_000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: -270_000_000,
            yoyPercent: 84.8
        )

        let display = metricYoYDisplay(for: metric)

        XCTAssertEqual(display?.text, "赤字縮小 84.8%")
        XCTAssertEqual(display?.tone, .positive)
        XCTAssertEqual(display?.direction, .positive)
    }

    func testMetricYoYDisplayUsesLossLanguageWhenOperatingLossWidens() {
        let metric = MetricPayload(
            logicalName: "operatingIncome",
            tagUsed: "us-gaap:OperatingIncomeLoss",
            value: -270_000_000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: -41_000_000,
            yoyPercent: -558.5
        )

        let display = metricYoYDisplay(for: metric)

        XCTAssertEqual(display?.text, "赤字拡大 558.5%")
        XCTAssertEqual(display?.tone, .negative)
        XCTAssertEqual(display?.direction, .negative)
    }

    func testMetricYoYDisplayKeepsSignedGrowthForRevenue() {
        let metric = MetricPayload(
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143_756_000_000,
            unit: "USD",
            periodEnd: "2026-03-28",
            comparisonValue: 124_300_000_000,
            yoyPercent: 15.7
        )

        XCTAssertEqual(metricYoYDisplay(for: metric)?.text, "+15.7%")
    }

    func testPrimarySourceReferenceUsesFirstMatchedSourceId() {
        let company = TestFixtures.companyPayload()

        let source = primarySourceReference(sourceIds: ["missing", "metric-op"], in: company)

        XCTAssertEqual(source?.sourceIdSnapshot, "metric-op")
        XCTAssertEqual(source?.sourceKind, .secFiling)
        XCTAssertEqual(source?.sourceUrl, company.primaryDocumentUrl)
    }

    func testPrimarySourceReferenceReturnsNilWhenInsightHasNoKnownSource() {
        let company = TestFixtures.companyPayload()

        XCTAssertNil(primarySourceReference(sourceIds: ["missing"], in: company))
    }

    func testInsightSourceChipsIncludeTappableXBRLSource() {
        let company = TestFixtures.companyPayload()

        let chips = insightSourceChips(sourceIds: ["metric-op"], in: company)

        XCTAssertEqual(chips.map(\.label), ["営業利益（XBRL）"])
        XCTAssertEqual(chips.first?.source?.sourceIdSnapshot, "metric-op")
    }

    func testInsightSourceChipsDeduplicateLabelsWhileKeepingFirstSource() {
        let company = TestFixtures.companyPayload()

        let chips = insightSourceChips(sourceIds: ["metric-op", "metric-op"], in: company)

        XCTAssertEqual(chips.count, 1)
        XCTAssertEqual(chips.first?.source?.sourceIdSnapshot, "metric-op")
    }

    func testDisplayableMessageSourcesDeduplicateRepeatedInvestorLabels() {
        let company = TestFixtures.companyPayload()
        let first = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: nil,
            sourceKind: .secFiling,
            sourceLabelSnapshot: "Part I, Item 2",
            excerpt: "Fuel prices affect operations.",
            sourceUrl: company.primaryDocumentUrl
        )
        let second = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: nil,
            sourceKind: .secFiling,
            sourceLabelSnapshot: "Item 2",
            excerpt: "Operating results depend on fuel prices.",
            sourceUrl: company.primaryDocumentUrl
        )

        let sources = displayableMessageSources([first, second], in: company)

        XCTAssertEqual(sources.count, 1)
        XCTAssertEqual(sources.first?.sourceLabelSnapshot, "Part I, Item 2")
    }

    func testResolvedExternalHTTPURLRejectsBareHtmlFilingNames() {
        XCTAssertNil(resolvedExternalHTTPURL(from: "entalagreementn.htm"))
        XCTAssertNil(resolvedExternalHTTPURL(from: "https://entalagreementn.htm"))
    }

    func testResolvedExternalHTTPURLAddsSchemeForBareCompanyDomain() {
        XCTAssertEqual(
            resolvedExternalHTTPURL(from: "www.alcoa.com/investors")?.absoluteString,
            "https://www.alcoa.com/investors"
        )
    }

    func testResolvedExternalHTTPURLAllowsHTMLPathOnRealDomain() {
        XCTAssertEqual(
            resolvedExternalHTTPURL(from: "www.alcoa.com/investors.html")?.absoluteString,
            "https://www.alcoa.com/investors.html"
        )
    }

    func testResolvedSourceURLResolvesSecRelativeFilingPathAgainstPrimaryDocument() {
        let company = TestFixtures.companyPayload()
        let source = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: nil,
            sourceKind: .secFiling,
            sourceLabelSnapshot: "Part I, Item 2",
            excerpt: "Fuel prices affect operations.",
            sourceUrl: "riskfactor.htm"
        )

        XCTAssertEqual(
            resolvedSourceURL(for: source, in: company)?.absoluteString,
            "https://www.sec.gov/Archives/riskfactor.htm"
        )
    }

    func testResolvedSourceURLRejectsRelativeWebSupplementPath() {
        let company = TestFixtures.companyPayload()
        let source = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: nil,
            sourceKind: .webSupplement,
            sourceLabelSnapshot: "Web",
            excerpt: "External context.",
            sourceUrl: "article.htm"
        )

        XCTAssertNil(resolvedSourceURL(for: source, in: company))
    }
}
