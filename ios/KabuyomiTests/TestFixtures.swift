import Foundation
@testable import Kabuyomi

enum TestFixtures {
    static func companyPayload(ticker: String = "AAPL") -> CompanyPayload {
        CompanyPayload(
            filingKey: "v1:\(ticker):0000320193-24-000001",
            ticker: ticker,
            companyName: "\(ticker) Holdings",
            cik: "0000320193",
            formType: "10-K",
            filedAt: "2024-11-01",
            periodOfReport: "2024-09-30",
            primaryDocumentUrl: "https://www.sec.gov/Archives/\(ticker).htm",
            summary: SummaryPayload(
                verdict: "\(ticker) は増収増益でした。",
                highlights: [
                    SummaryLinePayload(text: "サービス売上が伸びました。", sourceIds: ["md1"])
                ],
                changes: [
                    SummaryLinePayload(text: "営業利益率が改善しました。", sourceIds: ["metric-op"])
                ]
            ),
            metrics: [
                MetricPayload(
                    logicalName: "revenue",
                    tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
                    value: 383_285_000_000,
                    unit: "USD",
                    periodEnd: "2024-09-30",
                    comparisonValue: 365_817_000_000,
                    yoyPercent: 4.8
                ),
                MetricPayload(
                    logicalName: "operatingIncome",
                    tagUsed: "OperatingIncomeLoss",
                    value: 123_456_000_000,
                    unit: "USD",
                    periodEnd: "2024-09-30",
                    comparisonValue: 114_301_000_000,
                    yoyPercent: 8.0
                )
            ],
            historicalOverview: HistoricalOverviewPayload(
                comparisonBasis: "annual",
                years: 3,
                series: [
                    HistoricalMetricSeriesPayload(
                        logicalName: "revenue",
                        label: "売上高",
                        points: [
                            HistoricalMetricPointPayload(
                                filingKey: "v1:\(ticker):0000320193-22-000001",
                                filedAt: "2022-11-01",
                                periodEnd: "2022-09-30",
                                value: 365_817_000_000,
                                unit: "USD",
                                yoyPercent: 7.8,
                                sourceId: "metric-revenue-2022"
                            ),
                            HistoricalMetricPointPayload(
                                filingKey: "v1:\(ticker):0000320193-23-000001",
                                filedAt: "2023-11-01",
                                periodEnd: "2023-09-30",
                                value: 383_285_000_000,
                                unit: "USD",
                                yoyPercent: 4.8,
                                sourceId: "metric-revenue-2023"
                            ),
                            HistoricalMetricPointPayload(
                                filingKey: "v1:\(ticker):0000320193-24-000001",
                                filedAt: "2024-11-01",
                                periodEnd: "2024-09-30",
                                value: 401_220_000_000,
                                unit: "USD",
                                yoyPercent: 4.7,
                                sourceId: "metric-revenue-2024"
                            )
                        ]
                    )
                ]
            ),
            sourceChunks: [
                SourceChunkPayload(
                    sourceId: "md1",
                    sectionType: "md_a",
                    sectionTitle: "Management's Discussion and Analysis",
                    sourceLabel: "Item 7",
                    text: "Services revenue increased year over year.",
                    startOffset: 0,
                    endOffset: 42,
                    tagName: nil,
                    sortOrder: 0
                ),
                SourceChunkPayload(
                    sourceId: "metric-op",
                    sectionType: "xbrl_metric",
                    sectionTitle: "OperatingIncomeLoss",
                    sourceLabel: "OperatingIncomeLoss",
                    text: "123456000000",
                    startOffset: 0,
                    endOffset: 12,
                    tagName: "OperatingIncomeLoss",
                    sortOrder: 1
                )
            ],
            lastUpdatedAt: "2024-11-01T00:00:00.000Z"
        )
    }

    static func usagePayload() -> UsagePayload {
        UsagePayload(
            plan: "beta",
            chatsUsed: 1,
            chatLimit: 20,
            stocksUsed: 1,
            stockLimit: 25,
            dateJST: "2026-04-17"
        )
    }

    static func chatResponse() -> ChatResponse {
        ChatResponse(
            answer: "営業利益率は改善しました。",
            sources: [
                ChatSourcePayload(
                    sourceId: "metric-op",
                    sourceKind: .secFiling,
                    sectionType: "xbrl_metric",
                    sourceLabel: "OperatingIncomeLoss",
                    excerpt: "123456000000"
                )
            ],
            responsePath: .gemini,
            modelName: AIModelName.remoteFallback,
            usage: usagePayload()
        )
    }

    static func jsonData(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    static func searchResponseData() throws -> Data {
        try jsonData([
            "items": [
                [
                    "ticker": "MSFT",
                    "companyName": "Microsoft Corporation",
                    "cik": "0000789019",
                    "exchange": "NASDAQ",
                    "latestFormType": "10-K"
                ]
            ],
            "snapshotUpdatedAt": NSNull()
        ])
    }

    static func watchlistAddResponseData(ticker: String = "AAPL") throws -> Data {
        let company = companyPayload(ticker: ticker)
        return try jsonData([
            "company": [
                "filingKey": company.filingKey,
                "ticker": company.ticker,
                "companyName": company.companyName,
                "cik": company.cik,
                "formType": company.formType,
                "filedAt": company.filedAt,
                "periodOfReport": company.periodOfReport,
                "primaryDocumentUrl": company.primaryDocumentUrl,
                "summary": [
                    "verdict": company.summary.verdict,
                    "highlights": company.summary.highlights.map {
                        ["text": $0.text, "sourceIds": $0.sourceIds]
                    },
                    "changes": company.summary.changes.map {
                        ["text": $0.text, "sourceIds": $0.sourceIds]
                    }
                ],
                "metrics": company.metrics.map {
                    [
                        "logicalName": $0.logicalName,
                        "tagUsed": $0.tagUsed,
                        "value": $0.value,
                        "unit": $0.unit,
                        "periodEnd": $0.periodEnd,
                        "comparisonValue": jsonField($0.comparisonValue),
                        "yoyPercent": jsonField($0.yoyPercent)
                    ]
                },
                "historicalOverview": [
                    "comparisonBasis": company.historicalOverview?.comparisonBasis as Any,
                    "years": company.historicalOverview?.years as Any,
                    "series": company.historicalOverview?.series.map {
                        [
                            "logicalName": $0.logicalName,
                            "label": $0.label,
                            "points": $0.points.map {
                                [
                                    "filingKey": $0.filingKey,
                                    "filedAt": $0.filedAt,
                                    "periodEnd": $0.periodEnd,
                                    "value": $0.value,
                                    "unit": $0.unit,
                                    "yoyPercent": jsonField($0.yoyPercent),
                                    "sourceId": $0.sourceId
                                ]
                            }
                        ]
                    } as Any
                ],
                "sourceChunks": company.sourceChunks.map {
                    [
                        "sourceId": $0.sourceId,
                        "sectionType": $0.sectionType,
                        "sectionTitle": $0.sectionTitle,
                        "sourceLabel": $0.sourceLabel,
                        "text": $0.text,
                        "startOffset": $0.startOffset,
                        "endOffset": $0.endOffset,
                        "tagName": jsonField($0.tagName),
                        "sortOrder": $0.sortOrder
                    ]
                },
                "lastUpdatedAt": company.lastUpdatedAt
            ],
            "usage": [
                "plan": "beta",
                "chatsUsed": 0,
                "chatLimit": 20,
                "stocksUsed": 1,
                "stockLimit": 25,
                "dateJST": "2026-04-17"
            ]
        ])
    }

    private static func jsonField(_ value: Any?) -> Any {
        value ?? NSNull()
    }
}
