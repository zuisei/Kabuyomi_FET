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

    func testLocalizedAssistantDisplayTextHumanizesInternalEvidenceLabels() {
        let text = localizedAssistantDisplayText(
            "判断には、経営陣による業績説明、product revenue, services revenue, geographic revenue, product launches, channel inventory の追加確認が必要です。"
        )

        XCTAssertEqual(
            text,
            "判断には、経営陣による業績説明、製品別売上、サービス売上、地域別売上、新製品投入、販売チャネル在庫の追加確認が必要です。"
        )
    }

    func testLocalizedAssistantDisplayTextHumanizesSourceCoverageLabels() {
        let text = localizedAssistantDisplayText(
            "segment results, revenue discussion, sector-specific KPIs も確認すると精度が上がります。"
        )

        XCTAssertEqual(
            text,
            "セグメント別業績、売上要因の説明、業界固有KPIも確認すると精度が上がります。"
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

    func testAssistantMetricRowsExtractOnlyDisplayedAnswerValues() {
        let rows = assistantMetricRows(
            from: """
            売上高は 1,111.8億ドル で、前年同期比 +16.6% です。\
            営業利益は 358.9億ドル で、前年同期比 +21.3% です。\
            純利益は 295.8億ドル で、前年同期比 +19.4% です。
            """
        )

        XCTAssertEqual(rows.map(\.metric), ["売上高", "営業利益", "純利益"])
        XCTAssertEqual(rows.map(\.value), ["1,111.8億ドル", "358.9億ドル", "295.8億ドル"])
        XCTAssertEqual(rows.map(\.context), ["前年同期比 +16.6%", "前年同期比 +21.3%", "前年同期比 +19.4%"])
    }

    func testUnavailableMessageRequiresMoreThanPartialCaveat() {
        XCTAssertTrue(isUnavailableMessage("この決算資料の範囲では確認できません。"))
        XCTAssertFalse(
            isUnavailableMessage(
                "売上高は 1,437.6億ドル で、前年同期比 15.7%増 です。どの要因が一番効いたかは追加情報があると絞れます。"
            )
        )
    }

    func testPendingAssistantViewStateStartsWithJapanesePreparingLabel() {
        let submittedAt = Date()

        let state = buildPendingAssistantViewState(
            question: "前回決算との違いは？",
            submittedAt: submittedAt,
            now: submittedAt.addingTimeInterval(0.4),
            formType: "10-K"
        )

        XCTAssertEqual(state.badge, "整理中")
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

        XCTAssertEqual(state.badge, "検索中")
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

    func testAnalyticalQuestionUsesReadableSourceReferenceQuestion() {
        XCTAssertEqual(
            analyticalQuestion(from: "10-Q 項目2 の記述を確認できます"),
            "10-Q 項目2で何を確認する？"
        )
    }

    func testAnalyticalQuestionFallsBackToDocumentWordingForConfirmationText() {
        XCTAssertEqual(
            analyticalQuestion(from: "本文の記述を確認できます"),
            "提出資料の記述で何を確認する？"
        )
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

    // MARK: - v2 根拠チップの識別性

    private func mdChunk(id: String, title: String, text: String, order: Int) -> SourceChunkPayload {
        SourceChunkPayload(
            sourceId: id,
            sectionType: "md_a",
            sectionTitle: title,
            sourceLabel: "Item 7",
            text: text,
            startOffset: 0,
            endOffset: text.count,
            tagName: nil,
            sortOrder: order
        )
    }

    func testSourceSectionBadgeSeparatesFilingSectionKinds() {
        XCTAssertEqual(sourceSectionBadge(sectionType: "xbrl_metric"), "XBRL")
        XCTAssertEqual(sourceSectionBadge(sectionType: "historical_metric"), "履歴")
        XCTAssertEqual(sourceSectionBadge(sectionType: "historical_segment"), "セグメント")
        XCTAssertEqual(sourceSectionBadge(sectionType: "web_search"), "WEB")
        XCTAssertEqual(
            sourceSectionBadge(sectionType: "md_a", sectionTitle: "Item 1A. Risk Factors"),
            "リスク"
        )
        XCTAssertEqual(
            sourceSectionBadge(sectionType: "md_a", sectionTitle: "Management's Discussion and Analysis"),
            "MD&A"
        )
        XCTAssertEqual(sourceSectionBadge(sectionType: "md_a", sectionTitle: "Gross margin"), "本文")
    }

    /// 監査で「利益率」が3つ並んで見分けられなかった状態の回帰テスト。
    func testSourceChipDescriptorsDistinguishChunksThatShareOneLabel() {
        let company = TestFixtures.companyPayload()
        let chunks = [
            mdChunk(id: "m1", title: "Gross margin", text: "Gross margin increased to 46.6% in the second quarter.", order: 0),
            mdChunk(id: "m2", title: "Margin outlook", text: "Margin outlook was pressured by higher research spending.", order: 1),
            mdChunk(id: "m3", title: "Profitability", text: "Profitability improved on a favorable product mix.", order: 2)
        ]

        let descriptors = sourceChipDescriptors(for: chunks, in: company)

        XCTAssertEqual(descriptors.map(\.label), ["利益率", "利益率", "利益率"])
        XCTAssertEqual(Set(descriptors.compactMap(\.fragment)).count, 3)
        XCTAssertTrue(descriptors.allSatisfy { $0.ordinal == nil })
        XCTAssertTrue(descriptors.allSatisfy { $0.source?.sourceIdSnapshot != nil })
    }

    func testSourceChipDescriptorsNumberRowsThatStayIdenticalAfterBadgeAndFragment() {
        let company = TestFixtures.companyPayload()
        let chunks = [
            mdChunk(id: "m1", title: "Gross margin", text: "   ", order: 0),
            mdChunk(id: "m2", title: "Margin outlook", text: "", order: 1)
        ]

        let descriptors = sourceChipDescriptors(for: chunks, in: company)

        XCTAssertEqual(descriptors.map(\.label), ["利益率", "利益率"])
        XCTAssertEqual(descriptors.map(\.fragment), [nil, nil])
        XCTAssertEqual(descriptors.map(\.ordinal), [1, 2])
    }

    func testSourceChipDescriptorsDropRepeatsOfTheSameChunk() {
        let company = TestFixtures.companyPayload()
        let chunk = mdChunk(id: "m1", title: "Gross margin", text: "Gross margin increased.", order: 0)

        XCTAssertEqual(sourceChipDescriptors(for: [chunk, chunk], in: company).count, 1)
    }

    func testDisplayableMessageSourcesKeepDistinctEvidenceThatSharesOneLabel() {
        let company = TestFixtures.companyPayload()
        let sources = ["a", "b"].map { id in
            LocalMessageSourceRef(
                id: UUID(),
                sourceIdSnapshot: id,
                sourceKind: .secFiling,
                sourceLabelSnapshot: "Gross margin",
                excerpt: "Margin note \(id).",
                sourceUrl: nil
            )
        }

        XCTAssertEqual(displayableMessageSources(sources, in: company).count, 2)
        XCTAssertEqual(displayableMessageSources(sources + [sources[0]], in: company).count, 2)
    }

    // MARK: - v2 発見・履歴の密度

    /// ミッション文は初回だけ立て、保存や履歴がある人には控えめに落とす。
    func testMissionProminenceRecedesOnceTheUserHasHistory() {
        XCTAssertEqual(
            redesignMissionProminence(hasRecentCompanies: false, hasSavedCompanies: false),
            .prominent
        )
        XCTAssertEqual(
            redesignMissionProminence(hasRecentCompanies: true, hasSavedCompanies: false),
            .receded
        )
        XCTAssertEqual(
            redesignMissionProminence(hasRecentCompanies: false, hasSavedCompanies: true),
            .receded
        )
        XCTAssertEqual(
            redesignMissionProminence(hasRecentCompanies: true, hasSavedCompanies: true),
            .receded
        )
    }

    func testHistoryTrailingTextPacksAnswerCountAndLatestActivityIntoOneLine() {
        let activity = Date(timeIntervalSince1970: 1_777_000_000)
        XCTAssertEqual(
            redesignHistoryTrailingText(answerCount: 0, latestActivity: nil, formatted: { _ in "x" }),
            "回答なし"
        )
        XCTAssertEqual(
            redesignHistoryTrailingText(answerCount: 3, latestActivity: nil, formatted: { _ in "x" }),
            "回答 3件"
        )
        XCTAssertEqual(
            redesignHistoryTrailingText(answerCount: 3, latestActivity: activity, formatted: { _ in "5/2 14:03" }),
            "回答 3件 ・ 5/2 14:03"
        )
        XCTAssertEqual(
            redesignHistoryTrailingText(answerCount: 0, latestActivity: activity, formatted: { _ in "5/2 14:03" }),
            "回答なし ・ 5/2 14:03"
        )
    }

    // MARK: - v2 XBRL 抜粋の数値整形

    private func xbrlChunk(id: String, title: String, tag: String, text: String, order: Int) -> SourceChunkPayload {
        SourceChunkPayload(
            sourceId: id,
            sectionType: "xbrl_metric",
            sectionTitle: title,
            sourceLabel: "XBRL \(title) (\(tag))",
            text: text,
            startOffset: 0,
            endOffset: text.count,
            tagName: tag,
            sortOrder: order
        )
    }

    /// Worker が生の桁のまま出す抜粋(`workers/src/lib/filings/ingest.ts`)を、
    /// 主要数値グリッドと同じ体裁へ落とす。
    func testXBRLExcerptFormattingScalesRawUsdValues() {
        XCTAssertEqual(
            formattedXBRLExcerptText("営業CF: 82627000000 USD"),
            "営業CF: 826.3億ドル"
        )
        XCTAssertEqual(
            formattedXBRLExcerptText("売上高: 1200000000000 USD"),
            "売上高: 1.2兆ドル"
        )
        XCTAssertEqual(
            formattedXBRLExcerptText("営業利益: -410000000 USD"),
            "営業利益: -4.1億ドル"
        )
    }

    /// `比較値:` は単位を持たないので、同じ抜粋の先頭で見つけた単位を引き継ぐ。
    /// 比率と日付の断片は数値に見えても書き換えない。
    func testXBRLExcerptFormattingInheritsUnitAndLeavesNonMeasurementsAlone() {
        XCTAssertEqual(
            formattedXBRLExcerptText("営業CF: 82627000000 USD / 比較値: 71000000000 / YoY: 16.4%"),
            "営業CF: 826.3億ドル / 比較値: 710億ドル / YoY: 16.4%"
        )
    }

    /// 期末の併記は落とさない。
    func testXBRLExcerptFormattingKeepsThePeriodEndSuffix() {
        XCTAssertEqual(
            formattedXBRLExcerptText("営業CF（比較期）: 71000000000 USD / period end: 2025-03-29"),
            "営業CF（比較期）: 710億ドル / period end: 2025-03-29"
        )
        XCTAssertEqual(
            formattedXBRLExcerptText("純利益: 23640000000 USD (2026-03-28)"),
            "純利益: 236.4億ドル (2026-03-28)"
        )
    }

    /// 1株あたりの値は桁が読めるので換算しない。単位無しの素の数値も触らない。
    func testXBRLExcerptFormattingLeavesPerShareAndUnitlessValuesAlone() {
        XCTAssertEqual(
            formattedXBRLExcerptText("EPS（Basic）: 1.53 USD/shares"),
            "EPS（Basic）: 1.53 USD/shares"
        )
        XCTAssertEqual(formattedXBRLExcerptText("123456000000"), "123456000000")
        XCTAssertEqual(formattedXBRLExcerptText("EPS（Basic）: 1.53 USD/shares / 比較値: 1.40"), "EPS（Basic）: 1.53 USD/shares / 比較値: 1.40")
    }

    /// Worker 側で既に整形済みの履歴抜粋を二重に整形しない。
    func testXBRLExcerptFormattingDoesNotTouchAlreadyFormattedText() {
        let alreadyFormatted = "営業CF: 826.3億ドル (2026-03-28)"
        XCTAssertEqual(formattedXBRLExcerptText(alreadyFormatted), alreadyFormatted)
    }

    /// 本文(MD&A)の散文は XBRL ではないので整形経路に入らない。
    func testSourceChipFragmentsFormatXBRLValuesButLeaveNarrativeUntouched() {
        let company = TestFixtures.companyPayload()
        let chunks = [
            xbrlChunk(
                id: "x1",
                title: "営業CF",
                tag: "NetCashProvidedByUsedInOperatingActivities",
                text: "営業CF: 82627000000 USD / 比較値: 71000000000 / YoY: 16.4%",
                order: 0
            ),
            mdChunk(
                id: "m1",
                title: "Liquidity",
                text: "Note: 2024 was a record year for operating cash flow.",
                order: 1
            )
        ]

        let descriptors = sourceChipDescriptors(for: chunks, in: company)

        XCTAssertEqual(descriptors.count, 2)
        let xbrlFragment = descriptors[0].fragment ?? ""
        XCTAssertEqual(descriptors[0].badge, "XBRL")
        XCTAssertTrue(xbrlFragment.contains("826.3億ドル"), "got \(xbrlFragment)")
        XCTAssertFalse(xbrlFragment.contains("82627000000"), "got \(xbrlFragment)")
        XCTAssertEqual(descriptors[1].fragment, "Note: 2024 was a record year for operating cash flow.")
    }

    // MARK: - v2 購入・付与の状態色

    func testCreditSyncDisplayMapsRawBillingStatusesToStateTones() {
        XCTAssertEqual(creditSyncDisplay(status: "not_started"), CreditSyncDisplay(title: "未同期", tone: .neutral))
        XCTAssertEqual(
            creditSyncDisplay(status: "route_missing HTTP 404 /v1/ios/subscriptions/sync"),
            CreditSyncDisplay(title: "同期エラー", tone: .failed)
        )
        XCTAssertEqual(creditSyncDisplay(status: "sync_failed"), CreditSyncDisplay(title: "同期エラー", tone: .failed))
        XCTAssertEqual(creditSyncDisplay(status: "syncing"), CreditSyncDisplay(title: "同期中", tone: .pending))
        XCTAssertEqual(creditSyncDisplay(status: "granting"), CreditSyncDisplay(title: "同期中", tone: .pending))
        XCTAssertEqual(creditSyncDisplay(status: "succeeded"), CreditSyncDisplay(title: "同期済み", tone: .granted))
        XCTAssertEqual(creditSyncDisplay(status: "recovered"), CreditSyncDisplay(title: "同期済み", tone: .granted))
    }

    func testRewardedAdCreditToneKeepsUnresolvedGrantsInTheCautionState() {
        XCTAssertEqual(rewardedAdCreditTone(.idle), .neutral)
        XCTAssertEqual(rewardedAdCreditTone(.presenting), .neutral)
        XCTAssertEqual(rewardedAdCreditTone(.loading), .pending)
        XCTAssertEqual(rewardedAdCreditTone(.pendingGrant), .pending)
        XCTAssertEqual(rewardedAdCreditTone(.dailyCapReached), .pending)
    }

    func testHeaderCollapseUsesHysteresisSoItDoesNotFlapAtTheThreshold() {
        XCTAssertFalse(redesignHeaderCollapsed(current: false, offset: 0))
        XCTAssertFalse(redesignHeaderCollapsed(current: false, offset: 20))
        XCTAssertTrue(redesignHeaderCollapsed(current: false, offset: 40))
        // 一度畳んだら、戻す閾値まで下がるまで開かない。
        XCTAssertTrue(redesignHeaderCollapsed(current: true, offset: 20))
        XCTAssertFalse(redesignHeaderCollapsed(current: true, offset: 4))
    }
}
