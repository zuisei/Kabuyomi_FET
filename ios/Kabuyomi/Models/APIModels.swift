import Foundation

struct SearchResponse: Decodable {
    let items: [SearchItem]
    let snapshotUpdatedAt: String?
}

struct SearchItem: Decodable, Identifiable, Hashable {
    let ticker: String
    let companyName: String
    let cik: String
    let exchange: String
    let latestFormType: String?

    var id: String { ticker }

    enum FilingSupportStatus: Hashable {
        case supported(formType: String)
        case unsupported(formType: String)
        case unknown
    }

    var filingSupportStatus: FilingSupportStatus {
        guard let latestFormType, !latestFormType.isEmpty else {
            return .unknown
        }

        if latestFormType == "10-K" || latestFormType == "10-Q" {
            return .supported(formType: latestFormType)
        }

        return .unsupported(formType: latestFormType)
    }

    var hasSupportedLatestFiling: Bool {
        if case .supported = filingSupportStatus {
            return true
        }
        return false
    }

    var isSupportedInV1: Bool {
        hasSupportedLatestFiling
    }

    var supportDisplayLabel: String {
        switch filingSupportStatus {
        case .supported(let formType):
            return "最新 \(formType)"
        case .unsupported(let formType):
            return "\(formType) 対象"
        case .unknown:
            return "10-K / 10-Q 未確認"
        }
    }

    var availabilityBadgeTitle: String {
        switch filingSupportStatus {
        case .supported:
            return "保存可"
        case .unsupported:
            return "未対応"
        case .unknown:
            return "未確認"
        }
    }

    var availabilityNote: String {
        switch filingSupportStatus {
        case .supported:
            return "v1 でそのまま保存して会話できます。"
        case .unsupported(let formType):
            return "最新 \(formType) は v1 の対象外です。10-K / 10-Q のみ対応しています。"
        case .unknown:
            return "10-K / 10-Q を確認できる銘柄のみ保存できます。"
        }
    }

    var unsupportedAlertMessage: String {
        switch filingSupportStatus {
        case .supported:
            return ""
        case .unsupported(let formType):
            return "この銘柄の最新開示は \(formType) で、Kabuyomi v1 の対象外です。10-K / 10-Q のみ対応しています。"
        case .unknown:
            return "この銘柄は 10-K / 10-Q をまだ確認できないため、今は保存できません。"
        }
    }
}

struct CompanyPayload: Codable, Hashable {
    let filingKey: String
    let ticker: String
    let companyName: String
    let cik: String
    let formType: String
    let filedAt: String
    let periodOfReport: String
    let primaryDocumentUrl: String
    let summary: SummaryPayload
    let metrics: [MetricPayload]
    let historicalOverview: HistoricalOverviewPayload?
    let sourceChunks: [SourceChunkPayload]
    let lastUpdatedAt: String
}

struct HistoricalOverviewPayload: Codable, Hashable {
    let comparisonBasis: String
    let years: Int
    let series: [HistoricalMetricSeriesPayload]
}

struct HistoricalMetricSeriesPayload: Codable, Identifiable, Hashable {
    let logicalName: String
    let label: String
    let points: [HistoricalMetricPointPayload]

    var id: String { logicalName }
}

struct HistoricalMetricPointPayload: Codable, Identifiable, Hashable {
    let filingKey: String
    let filedAt: String
    let periodEnd: String
    let value: Double
    let unit: String
    let yoyPercent: Double?
    let sourceId: String

    var id: String { "\(filingKey):\(periodEnd):\(sourceId)" }
}

struct SummaryPayload: Codable, Hashable {
    let verdict: String
    let highlights: [SummaryLinePayload]
    let changes: [SummaryLinePayload]
}

struct SummaryLinePayload: Codable, Identifiable, Hashable {
    let text: String
    let sourceIds: [String]

    var id: String {
        text + sourceIds.joined(separator: ":")
    }
}

struct MetricPayload: Codable, Identifiable, Hashable {
    let logicalName: String
    let tagUsed: String
    let value: Double
    let unit: String
    let periodEnd: String
    let comparisonValue: Double?
    let yoyPercent: Double?

    var id: String { logicalName }
}

struct SourceChunkPayload: Codable, Identifiable, Hashable {
    let sourceId: String
    let sectionType: String
    let sectionTitle: String
    let sourceLabel: String
    let text: String
    let startOffset: Int
    let endOffset: Int
    let tagName: String?
    let sortOrder: Int

    var id: String { sourceId }
}

struct WatchlistAddResponse: Decodable {
    let company: CompanyPayload
    let usage: UsagePayload
}

struct WatchlistRemoveResponse: Decodable {
    let usage: UsagePayload
}

enum ChatResponsePath: String, Decodable, Hashable {
    case historical
    case deterministic
    case fallback
    case gemini

    var usesRemoteModel: Bool {
        self == .gemini
    }
}

struct ChatResponse: Decodable {
    let answer: String
    let sources: [ChatSourcePayload]
    let responsePath: ChatResponsePath?
    let modelName: String?
    let usage: UsagePayload
}

enum MessageSourceKind: String, Decodable, Hashable {
    case secFiling = "sec_filing"
    case historicalFiling = "historical_filing"
    case webSupplement = "web_supplement"

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = (try? container.decode(String.self)) ?? Self.secFiling.rawValue
        self = Self(rawValue: rawValue) ?? .secFiling
    }

    var groundingCaption: String {
        switch self {
        case .secFiling:
            "SEC filing 根拠"
        case .historicalFiling:
            "過去提出資料根拠"
        case .webSupplement:
            "外部補足"
        }
    }

    var badgeTitle: String {
        switch self {
        case .secFiling:
            "SEC"
        case .historicalFiling:
            "履歴"
        case .webSupplement:
            "Web"
        }
    }

    var systemImage: String {
        switch self {
        case .secFiling:
            "checkmark.shield"
        case .historicalFiling:
            "clock.arrow.circlepath"
        case .webSupplement:
            "globe"
        }
    }
}

struct ChatSourcePayload: Decodable, Identifiable, Hashable {
    let sourceId: String
    let sourceKind: MessageSourceKind
    let sectionType: String
    let sourceLabel: String
    let excerpt: String

    var id: String { sourceId }
}

struct UsagePayload: Decodable, Hashable {
    let plan: String
    let chatsUsed: Int
    let chatLimit: Int
    let stocksUsed: Int
    let stockLimit: Int
    let dateJST: String
    let savedTickers: [String]?
    let accessMode: String?

    var detachedAccessMode: DetachedAccessMode? {
        guard let accessMode else { return nil }
        return DetachedAccessMode(rawValue: accessMode)
    }

    var displayPlanLabel: String {
        if let detachedAccessMode {
            return detachedAccessMode.displayLabel
        }
        return BillingCatalog.displayLabel(for: plan)
    }

    var displayChatLimit: String {
        if detachedAccessMode != nil {
            return "∞"
        }
        return displayLimit(chatLimit)
    }

    var displayStockLimit: String {
        if detachedAccessMode != nil {
            return "∞"
        }
        return displayLimit(stockLimit)
    }

    private func displayLimit(_ value: Int) -> String {
        String(value)
    }
}

struct BillingSyncRequest: Encodable {
    let originalTransactionId: String
    let productId: String?
    let active: Bool
}

struct BillingSyncResponse: Decodable {
    let plan: String
    let quotaSubject: String
    let productId: String?
    let syncedAt: String
}

struct WatchlistCard: Identifiable, Hashable {
    let filingKey: String
    let ticker: String
    let companyName: String
    let formType: String
    let filedAt: Date
    let verdict: String
    let metrics: [MetricPayload]
    let isPlaceholder: Bool

    var id: String { ticker }
}

struct StarterCompany: Identifiable, Hashable {
    let ticker: String
    let companyName: String

    var id: String { ticker }

    static let defaults: [StarterCompany] = [
        StarterCompany(ticker: "AAPL", companyName: "Apple Inc."),
        StarterCompany(ticker: "MSFT", companyName: "Microsoft Corporation"),
        StarterCompany(ticker: "NVDA", companyName: "NVIDIA Corporation"),
        StarterCompany(ticker: "AMZN", companyName: "Amazon.com, Inc."),
        StarterCompany(ticker: "TSLA", companyName: "Tesla, Inc.")
    ]
}

struct LocalCompanyRecord {
    let company: CompanyPayload
    let chatHistory: [LocalChatMessage]
}

struct LocalChatMessage: Identifiable, Hashable {
    let id: UUID
    let role: String
    let content: String
    let createdAt: Date
    let modelName: String
    let sources: [LocalMessageSourceRef]
}

struct LocalMessageSourceRef: Identifiable, Hashable {
    let id: UUID
    let sourceKind: MessageSourceKind
    let sourceLabelSnapshot: String
    let excerpt: String
}

enum MetricLabeler {
    static func title(for logicalName: String) -> String {
        switch logicalName {
        case "revenue":
            "売上高"
        case "netIncome":
            "純利益"
        case "epsBasic":
            "EPS"
        case "operatingIncome":
            "営業利益"
        case "operatingCashFlow":
            "営業CF"
        default:
            logicalName
        }
    }
}
