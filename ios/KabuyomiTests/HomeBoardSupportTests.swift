import XCTest
@testable import Kabuyomi

/// v2 IA(docs/ui-redesign-v2/V2_IA_SPEC.md)のホーム/研究タブの導出ロジック。
/// 画面を起動せずに、並び順・デルタピル・未読・アーカイブのグループ化を固定する。
final class HomeBoardSupportTests: XCTestCase {
    private func metric(
        _ logicalName: String,
        value: Double,
        comparisonValue: Double?,
        yoyPercent: Double?
    ) -> MetricPayload {
        MetricPayload(
            logicalName: logicalName,
            tagUsed: logicalName,
            value: value,
            unit: "USD",
            periodEnd: "2026-03-28",
            comparisonValue: comparisonValue,
            yoyPercent: yoyPercent
        )
    }

    private func card(
        ticker: String,
        companyName: String? = nil,
        formType: String = "10-Q",
        filedAt: Date,
        verdict: String = "",
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

    private func date(_ seconds: Double) -> Date {
        Date(timeIntervalSince1970: seconds)
    }

    // MARK: - 書き出し1文

    /// シミュレータ実機確認 2026-08-22 で出た欠陥。
    /// 「約16.6%増」の小数点を文末と読んで「約16.」で切っていた。
    func testLeadSentenceDoesNotCutAtADecimalPoint() {
        XCTAssertEqual(
            redesignLeadSentence("売上高は前年同期比で約16.6%増、主因は iPhone。次の四半期は不明。"),
            "売上高は前年同期比で約16.6%増、主因は iPhone。"
        )
    }

    func testLeadSentenceStopsAtRealSentenceBoundaries() {
        XCTAssertEqual(redesignLeadSentence("増収でした。減益でした。"), "増収でした。")
        XCTAssertEqual(redesignLeadSentence("Revenue rose. Margin fell."), "Revenue rose.")
        XCTAssertEqual(redesignLeadSentence("Revenue rose 16.6%."), "Revenue rose 16.6%.")
        XCTAssertEqual(redesignLeadSentence("句点のない一文"), "句点のない一文")
        XCTAssertNil(redesignLeadSentence("   "))
    }

    // MARK: - 盤面の並び

    /// シミュレータ実機確認 2026-08-22 で出た欠陥。
    /// 会社名未取得のカードは社名に ticker が入るので「AAPL / AAPL」と2段重なっていた。
    func testBoardSuppressesACompanyNameThatIsJustTheTicker() {
        // スターター表にある銘柄は、名前未取得のプレースホルダでも正式表記を出せる
        // (2026-08-22 の表記オーバーライド)。抑止の検証は表に無い銘柄で行う。
        XCTAssertEqual(homeBoardCompanyName(companyName: "AAPL", ticker: "AAPL"), "Apple Inc.")
        XCTAssertEqual(homeBoardCompanyName(companyName: "SOFI", ticker: "SOFI"), "")
        XCTAssertEqual(homeBoardCompanyName(companyName: " sofi ", ticker: "SOFI"), "")
        XCTAssertEqual(homeBoardCompanyName(companyName: "Apple Inc.", ticker: "AAPL"), "Apple Inc.")

        let rows = homeBoardRows(
            saved: [card(ticker: "SOFI", companyName: "SOFI", filedAt: .distantPast, isPlaceholder: true)],
            recent: [],
            lastOpenedAt: [:]
        )
        XCTAssertEqual(rows[0].companyName, "")
    }

    func testBoardPutsSavedCompaniesFirstAndKeepsTheGivenOrder() {
        let rows = homeBoardRows(
            saved: [
                card(ticker: "AAPL", filedAt: date(1_770_000_000)),
                card(ticker: "MSFT", filedAt: date(1_772_000_000))
            ],
            recent: [
                card(ticker: "NVDA", filedAt: date(1_776_000_000))
            ],
            lastOpenedAt: [:]
        )

        XCTAssertEqual(rows.map(\.ticker), ["AAPL", "MSFT", "NVDA"])
        XCTAssertEqual(rows.map(\.isSaved), [true, true, false])
    }

    /// 保存済みと最近の両方に出てくる会社は、保存側の位置に1回だけ出す。
    func testBoardDeduplicatesCompaniesPresentInBothLists() {
        let rows = homeBoardRows(
            saved: [card(ticker: "AAPL", filedAt: date(1_770_000_000))],
            recent: [
                card(ticker: "AAPL", filedAt: date(1_770_000_000)),
                card(ticker: "NVDA", filedAt: date(1_776_000_000))
            ],
            lastOpenedAt: [:]
        )

        XCTAssertEqual(rows.map(\.ticker), ["AAPL", "NVDA"])
        XCTAssertTrue(rows[0].isSaved)
    }

    // MARK: - デルタピル

    func testBoardDeltaUsesRevenueYoYWithASignedLabel() {
        let up = homeBoardDelta(metrics: [
            metric("revenue", value: 143_000, comparisonValue: 124_000, yoyPercent: 15.7),
            metric("netIncome", value: 23_000, comparisonValue: 24_000, yoyPercent: -4.2)
        ])
        XCTAssertEqual(up?.text, "+15.7%")
        XCTAssertEqual(up?.direction, .positive)
        XCTAssertEqual(up?.tone, .positive)

        let down = homeBoardDelta(metrics: [
            metric("revenue", value: 110_000, comparisonValue: 124_000, yoyPercent: -11.3)
        ])
        XCTAssertEqual(down?.text, "-11.3%")
        XCTAssertEqual(down?.direction, .negative)
        XCTAssertEqual(down?.tone, .negative)
    }

    /// 売上が無い会社で別の指標に差し替えない。行ごとに違う指標が並ぶと板として読めない。
    func testBoardDeltaIsAbsentWhenRevenueIsNotCached() {
        XCTAssertNil(homeBoardDelta(metrics: []))
        XCTAssertNil(
            homeBoardDelta(metrics: [
                metric("netIncome", value: 23_000, comparisonValue: 20_000, yoyPercent: 15.0)
            ])
        )
        XCTAssertNil(
            homeBoardDelta(metrics: [
                metric("revenue", value: 143_000, comparisonValue: nil, yoyPercent: nil)
            ])
        )
    }

    func testBoardRowCarriesTheRevenuePillAndPlaceholdersCarryNone() {
        let rows = homeBoardRows(
            saved: [
                card(
                    ticker: "AAPL",
                    filedAt: date(1_770_000_000),
                    metrics: [metric("revenue", value: 143_000, comparisonValue: 124_000, yoyPercent: 15.7)]
                ),
                card(ticker: "SOFI", filedAt: .distantPast, isPlaceholder: true)
            ],
            recent: [],
            lastOpenedAt: [:]
        )

        XCTAssertEqual(rows[0].delta?.text, "+15.7%")
        XCTAssertNil(rows[1].delta)
        XCTAssertTrue(rows[1].isPlaceholder)
    }

    // MARK: - サマリータブの3本ピル(Phase 5)

    /// 3本柱は常に 売上 → 営業利益 → 純利益 の順。
    /// `metrics` の並びは Worker のレスポンス次第で変わるので、それには従わない。
    func testBoardDeltasAlwaysUseTheSameOrderRegardlessOfMetricOrder() {
        let deltas = homeBoardDeltas(metrics: [
            metric("netIncome", value: 23_000, comparisonValue: 20_000, yoyPercent: 15.0),
            metric("epsBasic", value: 1.53, comparisonValue: 1.40, yoyPercent: 9.3),
            metric("operatingIncome", value: 43_000, comparisonValue: 35_000, yoyPercent: 22.9),
            metric("revenue", value: 143_000, comparisonValue: 124_000, yoyPercent: 15.7)
        ])

        XCTAssertEqual(deltas.map(\.logicalName), ["revenue", "operatingIncome", "netIncome"])
        XCTAssertEqual(deltas.map(\.label), ["売上高", "営業利益", "純利益"])
        XCTAssertEqual(deltas.map(\.display.text), ["+15.7%", "+22.9%", "+15.0%"])
    }

    /// 無い指標は詰めない。取得できていないことと横ばいであることを
    /// 同じ見た目にしないため、枠を空けたりゼロを置いたりしない。
    func testBoardDeltasOmitMetricsThatAreNotCachedAndNeverPad() {
        let onlyRevenue = homeBoardDeltas(metrics: [
            metric("revenue", value: 143_000, comparisonValue: 124_000, yoyPercent: 15.7)
        ])
        XCTAssertEqual(onlyRevenue.map(\.logicalName), ["revenue"])

        // 中抜け(売上と純利益だけ)でも、残りの2本は同じ順序で並ぶ。
        let gapped = homeBoardDeltas(metrics: [
            metric("revenue", value: 143_000, comparisonValue: 124_000, yoyPercent: 15.7),
            metric("netIncome", value: 23_000, comparisonValue: 20_000, yoyPercent: 15.0)
        ])
        XCTAssertEqual(gapped.map(\.logicalName), ["revenue", "netIncome"])

        XCTAssertTrue(homeBoardDeltas(metrics: []).isEmpty)
    }

    /// YoY が無い指標(前年比較の取れていない初回 filing)はピルにならない。
    /// `metricYoYDisplay` が nil を返すものは、指標があってもピルを作らない。
    func testBoardDeltasSkipMetricsWithoutAYoYComparison() {
        let deltas = homeBoardDeltas(metrics: [
            metric("revenue", value: 143_000, comparisonValue: nil, yoyPercent: nil),
            metric("operatingIncome", value: 43_000, comparisonValue: 35_000, yoyPercent: 22.9)
        ])

        XCTAssertEqual(deltas.map(\.logicalName), ["operatingIncome"])
    }

    /// VoiceOver ラベルは「{指標名} 前年同期比 {変化}」。
    /// 3本並ぶと色でも位置でも指標を判別できないので、ラベルが唯一の手がかりになる。
    func testBoardDeltaAccessibilityTextNamesTheMetric() {
        let deltas = homeBoardDeltas(metrics: [
            metric("revenue", value: 143_000, comparisonValue: 124_000, yoyPercent: 16.6),
            metric("operatingIncome", value: -410, comparisonValue: -2_700, yoyPercent: 84.8)
        ])

        XCTAssertEqual(deltas[0].accessibilityText, "売上高 前年同期比 +16.6%")
        // 赤字の会社では符号ではなく日本語の書き分けが入る。ラベルはそれをそのまま読む。
        XCTAssertEqual(deltas[1].accessibilityText, "営業利益 前年同期比 赤字縮小 84.8%")
    }

    /// 行の `delta`(ストリームの資料イベントが使う売上1本)は3本ピルから引く。
    /// 売上が無い会社では、別の指標に化けずに nil のままであること。
    func testBoardRowRevenueDeltaIsDerivedFromTheThreePillsWithoutSubstitution() {
        let rows = homeBoardRows(
            saved: [
                card(
                    ticker: "SNAP",
                    filedAt: date(1_770_000_000),
                    metrics: [metric("netIncome", value: 23_000, comparisonValue: 20_000, yoyPercent: 15.0)]
                )
            ],
            recent: [],
            lastOpenedAt: [:]
        )

        XCTAssertEqual(rows[0].deltas.map(\.logicalName), ["netIncome"])
        XCTAssertNil(rows[0].delta)
    }

    // MARK: - 未読

    /// 最終閲覧時刻が無い会社は既読扱い。
    /// この状態は v2 で新設したので、更新前から保存されている会社には記録が無い。
    /// 「記録なし=未読」にすると更新直後の初回起動で盤面が丸ごとドットで埋まる。
    func testUnreadTreatsAnAbsentLastOpenedTimestampAsRead() {
        XCTAssertFalse(
            homeBoardIsUnread(filedAt: date(1_776_000_000), isPlaceholder: false, lastOpenedAt: nil)
        )
    }

    func testUnreadIsSetOnlyWhenTheCachedFilingIsNewerThanTheLastOpen() {
        XCTAssertTrue(
            homeBoardIsUnread(
                filedAt: date(1_776_000_000),
                isPlaceholder: false,
                lastOpenedAt: date(1_770_000_000)
            )
        )
        XCTAssertFalse(
            homeBoardIsUnread(
                filedAt: date(1_770_000_000),
                isPlaceholder: false,
                lastOpenedAt: date(1_776_000_000)
            )
        )
        // 同時刻は未読にしない(開いた資料がそのまま未読へ戻るのを避ける)。
        XCTAssertFalse(
            homeBoardIsUnread(
                filedAt: date(1_770_000_000),
                isPlaceholder: false,
                lastOpenedAt: date(1_770_000_000)
            )
        )
    }

    /// まだ filing を取れていない行にドットは付けない(.distantPast で常に「古い」ため)。
    func testUnreadIgnoresPlaceholderRows() {
        XCTAssertFalse(
            homeBoardIsUnread(filedAt: .distantPast, isPlaceholder: true, lastOpenedAt: date(1_776_000_000))
        )
    }

    func testBoardRowsApplyUnreadPerCompany() {
        let rows = homeBoardRows(
            saved: [
                card(ticker: "AAPL", filedAt: date(1_776_000_000)),
                card(ticker: "MSFT", filedAt: date(1_760_000_000))
            ],
            recent: [card(ticker: "NVDA", filedAt: date(1_776_000_000))],
            lastOpenedAt: [
                "AAPL": date(1_770_000_000),
                "MSFT": date(1_770_000_000)
            ]
        )

        XCTAssertEqual(rows.map(\.isUnread), [true, false, false])
    }

    // MARK: - 新着

    func testFeedOrdersByFiledAtDescendingAndBreaksTiesByTicker() {
        let rows = homeFeedRows(
            saved: [
                card(ticker: "MSFT", filedAt: date(1_770_000_000)),
                card(ticker: "AAPL", filedAt: date(1_770_000_000))
            ],
            recent: [card(ticker: "NVDA", filedAt: date(1_776_000_000))]
        )

        XCTAssertEqual(rows.map(\.ticker), ["NVDA", "AAPL", "MSFT"])
    }

    func testFeedDropsPlaceholdersAndDeduplicatesCompanies() {
        let rows = homeFeedRows(
            saved: [
                card(ticker: "SOFI", filedAt: .distantPast, isPlaceholder: true),
                card(ticker: "AAPL", filedAt: date(1_770_000_000))
            ],
            recent: [card(ticker: "AAPL", filedAt: date(1_770_000_000))]
        )

        XCTAssertEqual(rows.map(\.ticker), ["AAPL"])
    }

    func testFeedHonoursTheLimit() {
        let cards = (0..<5).map { index in
            card(ticker: "T\(index)", filedAt: date(1_770_000_000 + Double(index)))
        }
        let rows = homeFeedRows(saved: cards, recent: [], limit: 3)
        XCTAssertEqual(rows.map(\.ticker), ["T4", "T3", "T2"])
    }

    func testFeedCarriesTheVerdictLine() {
        let rows = homeFeedRows(
            saved: [
                card(
                    ticker: "AAPL",
                    filedAt: date(1_776_000_000),
                    verdict: "増収増益でした。サービスが牽引しています。"
                )
            ],
            recent: []
        )

        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].verdictLine, "増収増益でした。")
    }

    /// verdict の書き出し1文だけを取り、無ければ社名で代替する。
    func testFeedVerdictLineFallsBackToTheCompanyName() {
        XCTAssertEqual(
            homeFeedVerdictLine(verdict: "  ", companyName: "Apple Inc."),
            "Apple Inc."
        )
        XCTAssertEqual(
            homeFeedVerdictLine(verdict: "売上は横ばい。利益率は改善。", companyName: "Apple Inc."),
            "売上は横ばい。"
        )
    }

    // MARK: - 研究(Q&A アーカイブ)

    private func message(_ role: String, _ content: String, at seconds: Double) -> LocalChatMessage {
        LocalChatMessage(
            id: UUID(),
            role: role,
            content: content,
            createdAt: date(seconds),
            modelName: "",
            sources: []
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

    func testArchiveGroupsByCompanyNewestFirstAndOrdersQuestionsNewestFirst() {
        let groups = researchArchiveGroups(records: [
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:1",
                messages: [
                    message("user", "売上の要因は？", at: 1_770_000_000),
                    message("assistant", "サービスが伸びました。", at: 1_770_000_060),
                    message("user", "利益率は？", at: 1_770_000_600),
                    message("assistant", "改善しています。", at: 1_770_000_660)
                ]
            ),
            record(
                ticker: "MSFT",
                filingKey: "v1:MSFT:1",
                messages: [
                    message("user", "クラウドは？", at: 1_780_000_000),
                    message("assistant", "堅調です。", at: 1_780_000_060)
                ]
            )
        ])

        XCTAssertEqual(groups.map(\.ticker), ["MSFT", "AAPL"])
        XCTAssertEqual(groups[1].entries.map(\.question), ["利益率は？", "売上の要因は？"])
        XCTAssertEqual(groups[1].questionCount, 2)
        XCTAssertEqual(groups[0].latestActivity, date(1_780_000_060))
    }

    /// 同じ会社の別 filing の会話は1グループにまとまり、質問行は filing を持ち続ける。
    func testArchiveMergesMultipleFilingsOfTheSameCompany() {
        let groups = researchArchiveGroups(records: [
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:old",
                messages: [
                    message("user", "前期の売上は？", at: 1_760_000_000),
                    message("assistant", "増収でした。", at: 1_760_000_060)
                ]
            ),
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:new",
                messages: [
                    message("user", "今期の売上は？", at: 1_790_000_000),
                    message("assistant", "さらに増収でした。", at: 1_790_000_060)
                ]
            )
        ])

        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].entries.map(\.question), ["今期の売上は？", "前期の売上は？"])
        XCTAssertEqual(groups[0].entries.map(\.filingKey), ["v1:AAPL:new", "v1:AAPL:old"])
    }

    func testArchiveCountsAnswersPerQuestionAndPreviewsTheFirstAnswer() {
        let groups = researchArchiveGroups(records: [
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:1",
                messages: [
                    message("user", "売上の要因は？", at: 1_770_000_000),
                    message("assistant", "サービスが伸びました。詳細は本文にあります。", at: 1_770_000_060),
                    message("assistant", "補足です。", at: 1_770_000_120),
                    message("user", "利益率は？", at: 1_770_000_600)
                ]
            )
        ])

        let entries = groups[0].entries
        XCTAssertEqual(entries[0].question, "利益率は？")
        XCTAssertEqual(entries[0].answerCount, 0)
        XCTAssertNil(entries[0].answerPreview)
        XCTAssertEqual(entries[0].latestActivity, date(1_770_000_600))

        XCTAssertEqual(entries[1].question, "売上の要因は？")
        XCTAssertEqual(entries[1].answerCount, 2)
        XCTAssertEqual(entries[1].answerPreview, "サービスが伸びました。")
        XCTAssertEqual(entries[1].latestActivity, date(1_770_000_120))
    }

    /// 質問が1件も無い会話はアーカイブに出さない(研究タブの主役は Q&A)。
    func testArchiveSkipsRecordsWithoutQuestions() {
        let groups = researchArchiveGroups(records: [
            record(
                ticker: "AAPL",
                filingKey: "v1:AAPL:1",
                messages: [message("assistant", "要約です。", at: 1_770_000_000)]
            ),
            record(
                ticker: "MSFT",
                filingKey: "v1:MSFT:1",
                messages: [message("user", "   ", at: 1_770_000_000)]
            )
        ])

        XCTAssertTrue(groups.isEmpty)
    }

    // SEC 提出者名は全大文字が多い(NVIDIA CORP)。表記を持っている会社は
    // 正式表記を優先し、持っていない会社は加工しない(Nvidia Corp は NVIDIA より悪い嘘)。
    func testCompanyNamePrefersCuratedStarterSpelling() {
        XCTAssertEqual(homeBoardCompanyName(companyName: "NVIDIA CORP", ticker: "NVDA"), "NVIDIA Corporation")
        XCTAssertEqual(homeBoardCompanyName(companyName: "Apple Inc.", ticker: "AAPL"), "Apple Inc.")
        XCTAssertEqual(homeBoardCompanyName(companyName: "COCA COLA CO", ticker: "KO"), "COCA COLA CO")
    }
}
