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

    var canAttemptInV1: Bool {
        if case .unsupported = filingSupportStatus {
            return false
        }
        return true
    }

    var requiresFilingVerification: Bool {
        if case .unknown = filingSupportStatus {
            return true
        }
        return false
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
            return "保存または表示時に 10-K / 10-Q を確認します。"
        }
    }

    var unsupportedAlertMessage: String {
        switch filingSupportStatus {
        case .supported:
            return ""
        case .unsupported(let formType):
            return "この銘柄の最新開示は \(formType) で、Kabuyomi v1 の対象外です。10-K / 10-Q のみ対応しています。"
        case .unknown:
            return "この銘柄は 10-K / 10-Q をまだ確認できませんでした。時間を置いてもう一度お試しください。"
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
    let companyWebsiteUrl: String?
    let summary: SummaryPayload
    let metrics: [MetricPayload]
    let historicalOverview: HistoricalOverviewPayload?
    let sourceChunks: [SourceChunkPayload]
    let lastUpdatedAt: String
    let status: CompanyLoadStatus?
    let statusMessage: String?
    let retryAfterSeconds: Int?

    init(
        filingKey: String,
        ticker: String,
        companyName: String,
        cik: String,
        formType: String,
        filedAt: String,
        periodOfReport: String,
        primaryDocumentUrl: String,
        companyWebsiteUrl: String?,
        summary: SummaryPayload,
        metrics: [MetricPayload],
        historicalOverview: HistoricalOverviewPayload?,
        sourceChunks: [SourceChunkPayload],
        lastUpdatedAt: String,
        status: CompanyLoadStatus? = nil,
        statusMessage: String? = nil,
        retryAfterSeconds: Int? = nil
    ) {
        self.filingKey = filingKey
        self.ticker = ticker
        self.companyName = companyName
        self.cik = cik
        self.formType = formType
        self.filedAt = filedAt
        self.periodOfReport = periodOfReport
        self.primaryDocumentUrl = primaryDocumentUrl
        self.companyWebsiteUrl = companyWebsiteUrl
        self.summary = summary
        self.metrics = metrics
        self.historicalOverview = historicalOverview
        self.sourceChunks = sourceChunks
        self.lastUpdatedAt = lastUpdatedAt
        self.status = status
        self.statusMessage = statusMessage
        self.retryAfterSeconds = retryAfterSeconds
    }

    var isStaleReady: Bool {
        status == .staleReady
    }
}

enum CompanyLoadStatus: String, Codable, Hashable {
    case ready
    case staleReady = "stale_ready"
    case preparing
    case failedRetryable = "failed_retryable"
}

struct CompanyLoadStatePayload: Codable, Hashable {
    let status: CompanyLoadStatus
    let ticker: String
    let companyName: String?
    let cik: String?
    let message: String?
    let statusMessage: String?
    let retryAfterSeconds: Int?

    var displayMessage: String? {
        statusMessage ?? message
    }
}

enum CompanyLoadResponse: Decodable {
    case company(CompanyPayload)
    case retryable(CompanyLoadStatePayload)

    private enum CodingKeys: String, CodingKey {
        case filingKey
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.filingKey) {
            self = .company(try CompanyPayload(from: decoder))
            return
        }

        self = .retryable(try CompanyLoadStatePayload(from: decoder))
    }
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
    let company: CompanyPayload?
    let loadState: CompanyLoadStatePayload?
    let usage: UsagePayload

    private enum CodingKeys: String, CodingKey {
        case company
        case usage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        company = try container.decodeIfPresent(CompanyPayload.self, forKey: .company)
        usage = try container.decode(UsagePayload.self, forKey: .usage)
        loadState = company == nil ? try CompanyLoadStatePayload(from: decoder) : nil
    }
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
    let creditsCharged: Int?
    let creditsRemaining: Int?
}

struct QuoteTranslationResponse: Decodable {
    let translatedText: String
    let modelName: String
    let usage: UsagePayload?
    let creditsCharged: Int?
    let creditsRemaining: Int?
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
            "SEC資料根拠"
        case .historicalFiling:
            "過去資料根拠"
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
    let sourceUrl: String?

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
    let credits: CreditUsagePayload?
    let creditBillingEnabled: Bool?

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

struct CreditUsagePayload: Decodable, Hashable {
    let monthlyRemaining: Int
    let monthlyLimit: Int
    let purchasedRemaining: Int
    let totalRemaining: Int
    let resetsAt: String

    var hasChatCredit: Bool {
        totalRemaining >= 1
    }
}

struct BillingSyncRequest: Encodable {
    let originalTransactionId: String
    let transactionId: String?
    let productId: String?
    let active: Bool
    let signedTransactionInfo: String?
}

struct CreditPurchaseGrantRequest: Encodable {
    let productId: String
    let transactionId: String
    let originalTransactionId: String?
    let purchasedAt: String?
    let signedTransactionInfo: String?
}

struct CreditPurchaseGrantResponse: Decodable {
    let transactionId: String
    let productId: String
    let creditsGranted: Int
    let creditsRemaining: Int
    let transactionStatus: String
    let didMutate: Bool
    let usage: UsagePayload
}

struct ChatContextMessage: Encodable, Equatable {
    let role: String
    let content: String
}

struct ChatRequest: Encodable {
    let filingKey: String
    let question: String
    let conversationContext: [ChatContextMessage]
    let operationId: String
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
    let sourceIdSnapshot: String?
    let sourceKind: MessageSourceKind
    let sourceLabelSnapshot: String
    let excerpt: String
    let sourceUrl: String?
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
