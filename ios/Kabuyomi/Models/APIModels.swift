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
}

struct CompanyPayload: Decodable, Hashable {
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
    let sourceChunks: [SourceChunkPayload]
    let lastUpdatedAt: String
}

struct SummaryPayload: Decodable, Hashable {
    let verdict: String
    let highlights: [SummaryLinePayload]
    let changes: [SummaryLinePayload]
}

struct SummaryLinePayload: Decodable, Identifiable, Hashable {
    let text: String
    let sourceIds: [String]

    var id: String {
        text + sourceIds.joined(separator: ":")
    }
}

struct MetricPayload: Decodable, Identifiable, Hashable {
    let logicalName: String
    let tagUsed: String
    let value: Double
    let unit: String
    let periodEnd: String
    let comparisonValue: Double?
    let yoyPercent: Double?

    var id: String { logicalName }
}

struct SourceChunkPayload: Decodable, Identifiable, Hashable {
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

struct ChatResponse: Decodable {
    let answer: String
    let sources: [ChatSourcePayload]
    let usage: UsagePayload
}

enum MessageSourceKind: String, Decodable, Hashable {
    case secFiling = "sec_filing"
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
        case .webSupplement:
            "外部補足"
        }
    }

    var badgeTitle: String {
        switch self {
        case .secFiling:
            "SEC"
        case .webSupplement:
            "Web"
        }
    }

    var systemImage: String {
        switch self {
        case .secFiling:
            "checkmark.shield"
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

    var displayPlanLabel: String {
        "BETA"
    }

    var displayChatLimit: String {
        displayLimit(chatLimit)
    }

    var displayStockLimit: String {
        displayLimit(stockLimit)
    }

    private func displayLimit(_ value: Int) -> String {
        value >= 9_000_000_000 ? "—" : String(value)
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
