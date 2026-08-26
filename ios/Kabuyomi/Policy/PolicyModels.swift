import Foundation

struct DemoEnvelope: Codable {
    let schemaVersion: Int
    let isSyntheticDataset: Bool?
    let datasetLabelJA: String?
    let events: [PolicyEvent]
}

struct PolicyEvent: Identifiable, Hashable, Codable {
    let id: UUID
    let isSynthetic: Bool
    let lastActivityAt: Date
    let agency: Agency
    let titleJA, titleEN, summaryJA: String
    let topics, tickers: [String]
    let category: PolicyCategory
    let status: EventStatus
    let timestampState: TimestampState
    let analysisAnchor: AnalysisAnchor
    let officialPublicationDate: String?
    let publishedAt, detectedAt, revisedAt: Date?
    let sourceURL: URL?
    let documentInfo: DocumentInfo
    let timelineItems: [TimelineItem]
    let exposures: [CompanyExposure]
    let marketSummaries: [MarketSummary]
    let marketSeries: [MarketPoint]
    let marketProvenance: MarketDataProvenance?
    let confounders: [Confounder]
    let confounderReviewState: ConfounderReviewState?
    let importantClauses: [ImportantClause]?
    let documentVersions: [DocumentVersion]
    let documents: [PolicyDocument]?
    let relationshipCandidates: [DocumentRelationshipCandidate]?
    let documentDiff: DocumentDiff?
    let correctionNotes: [CorrectionNote]
    let coverageState: CoverageState?
    let eventVerificationState: EventVerificationState?
    let instrumentType: PolicyInstrumentType?
    let policyDomain: PolicyDomainReference?
    let analysis: PolicyAnalysis?
    let translation: PolicyTranslation?

    var anchorDate: Date { publishedAt ?? detectedAt ?? lastActivityAt }
    var productAnalysis: PolicyAnalysis { analysis ?? PolicyAnalysis.fallback(for: self) }
    var relatedDocuments: [PolicyDocument] {
        if let documents, !documents.isEmpty { return documents.sorted { $0.availableAt < $1.availableAt } }
        guard let version = documentVersions.last else { return [] }
        let isDateOnlyPublication = publishedAt == nil && officialPublicationDate != nil
        return [PolicyDocument(
            id: id, documentType: .other, relationship: .primary, correctsDocumentID: nil,
            documentNumber: documentInfo.documentNumber, publisherJA: documentInfo.publisherJA, publisherEN: documentInfo.publisherEN,
            titleJA: version.titleJA, titleEN: titleEN, officialURL: sourceURL, publishedOn: officialPublicationDate,
            effectiveOn: nil, applicableOn: nil, commentsCloseOn: nil, sourceStatedAt: nil, sourceStatedTimezone: nil,
            firstObservedAt: detectedAt ?? version.publishedAt, ingestedAt: detectedAt ?? version.publishedAt,
            availableAt: publishedAt ?? detectedAt ?? version.publishedAt, availabilityBasis: timestampState == .officialExact ? .sourceStated : .firstObserved,
            timePrecision: isDateOnlyPublication ? .day : timestampState == .officialExact ? .exact : .minute, currentRevision: documentInfo.currentVersion,
            contentHash: documentInfo.contentHash, bodyJA: version.bodyJA, bodyEN: version.bodyEN,
            govInfoPDFURL: nil, publicInspectionPDFURL: nil, docketIDs: nil, regulationIDNumbers: nil, cfrReferences: nil
        )]
    }
}

struct Agency: Hashable, Codable { let code, displayNameJA, displayNameEN: String }
enum PolicyCategory: String, Hashable, Codable {
    case semiconductorExportControls, semiconductorIndustrialPolicy, tariffPolicy, semiconductorGrantPolicy
    case foreignSecurity, defenseProcurement, tradeTariffs, exportControlsSanctions, financialRegulation
    case monetaryPolicy, taxBudget, antitrust, technologyAI, telecommunications, energyNuclear
    case environmentClimate, healthMedicine, laborEmployment, immigrationBorder, agricultureFood
    case transportation, housingRealEstate, education, consumerProtection, industrialPolicy
}
enum CoverageState: String, Hashable, Codable { case metadataOnly = "metadata_only", contentFetched = "content_fetched", sourceVerified = "source_verified", analystEnriched = "analyst_enriched", marketMapped = "market_mapped" }
enum EventVerificationState: String, Hashable, Codable { case unverified, sourceVerified = "source_verified", analystVerified = "analyst_verified" }
enum PolicyInstrumentType: String, Hashable, Codable, CaseIterable {
    case finalRule = "final_rule", proposedRule = "proposed_rule", interimFinalRule = "interim_final_rule", notice
    case correctingAmendment = "correcting_amendment", withdrawal, guidance, executiveOrder = "executive_order"
    case presidentialMemorandum = "presidential_memorandum", proclamation, factSheet = "fact_sheet"
    case agencyPressRelease = "agency_press_release", sanctionsDesignation = "sanctions_designation"
    case exportControlAction = "export_control_action", tariffAction = "tariff_action"
    case legislativeBillResolution = "legislative_bill_resolution", committeeActionHearing = "committee_action_hearing"
    case monetaryPolicyDecision = "monetary_policy_decision", enforcementAction = "enforcement_action"
    case grantSubsidyProgram = "grant_subsidy_program", governmentContractAward = "government_contract_award"
}
struct PolicyDomainReference: Hashable, Codable { let slug, labelJA: String }
enum EventStatus: String, Hashable, Codable { case published, revised, corrected }
enum TimestampState: String, Hashable, Codable { case officialExact, systemDetectedOnly }
enum AnalysisAnchor: String, Hashable, Codable { case officialPublication, systemDetection }
enum TimelineItemKind: String, Hashable, Codable { case officialPublication, systemDetection, officialStatement, mediaReport, documentRevision, marketReaction, correction }
enum SourceType: String, Hashable, Codable { case official, system, secondary, market }
enum VerificationState: String, Hashable, Codable { case humanVerified, systemObserved, automaticUnverified, calculated }
enum ExposureRelationship: String, Hashable, Codable {
    case direct, indirect, supplier, customer, competitor
    case supplyChain = "supply_chain"
    case geographicExposure = "geographic_exposure"
    case policyBeneficiary = "policy_beneficiary"
    case policyRisk = "policy_risk"
    case sectorProxy = "sector_proxy"
    case benchmark, candidate
}
enum ReactionWindow: String, Hashable, Codable {
    case fiveMinutes, thirtyMinutes, twoHours, sameDayClose, nextDayClose, fiveTradingDays
    case nextRegularSessionOpen, fiveMinutesAfterOpen, thirtyMinutesAfterOpen, twoHoursAfterOpen
    case previousCloseToOpen, previousCloseToClose, closeToNextClose, fiveTradingDayReturn
    case thirtyMinutesFromDetection
}
enum ConfounderReviewState: String, Hashable, Codable { case unreviewed, verifiedNone = "verified_none", candidate, verified }

enum PolicyAnalysisStatus: String, Hashable, Codable {
    case unreviewed
    case automatedDraft = "automated_draft"
    case editorialReviewed = "editorial_reviewed"
    case published
    case rejected
}

enum PolicyTranslationFieldStatus: String, Hashable, Codable {
    case machineTranslated = "machine_translated"
    case editorialReviewed = "editorial_reviewed"
    case rejected
}

struct PolicyTranslation: Hashable, Codable {
    let titleStatus: PolicyTranslationFieldStatus
    let factualSummaryStatus: PolicyTranslationFieldStatus
    let sourceLanguage, provider, model, promptVersion: String
    let translatedAt: Date
    let sourceContentHash: String
}

enum TranslationRequestMode: String, Hashable, Codable {
    case automatic
    case onDemand = "on_demand"
}

enum TranslationRequestState: String, Hashable, Codable {
    case available, queued, processing, retry, failed, translated
    case batchProcessing = "batch_processing"
    case unavailable
}

struct TranslationRequestStatus: Hashable, Codable {
    let eventID: UUID
    let mode: TranslationRequestMode
    let state: TranslationRequestState
    let requestedAt, updatedAt: Date?
    let retryAfterSeconds: Int?

    var shouldPoll: Bool {
        state == .queued || state == .processing || state == .retry
    }

    var canRequest: Bool {
        state == .failed || (mode == .onDemand && state == .available)
    }

    func pollDelaySeconds(attempt: Int) -> Int {
        if state == .retry, let retryAfterSeconds, retryAfterSeconds > 0 {
            return min(max(retryAfterSeconds, 2), 30)
        }
        return attempt < 15 ? 2 : 5
    }
}

enum PresentationTier: String, Hashable, Codable, CaseIterable { case signal, monitor, archive }

enum MarketAnalysisMode: String, Hashable, Codable, CaseIterable {
    case intraday, daily, unmapped
    case notApplicable = "not_applicable"
    case disabled
}

enum CompanyRelationType: String, Hashable, Codable {
    case direct, indirect
    case supplyChain = "supply_chain"
    case competitor, customer
    case geographicExposure = "geographic_exposure"
    case policyBeneficiary = "policy_beneficiary"
    case policyRisk = "policy_risk"
}

enum CompanyRelationReviewStatus: String, Hashable, Codable { case candidate, approved, rejected }

struct PolicyCompanyRelation: Identifiable, Hashable, Codable {
    let id: UUID
    let issuerID: String
    let issuerName: String
    let securityID: String?
    let ticker: String?
    let relationType: CompanyRelationType
    let evidenceDocumentID: UUID?
    let evidenceReference, evidenceSummaryJA: String
    let reviewStatus: CompanyRelationReviewStatus
    let reviewedAt: Date?
}

struct PolicyAnalysis: Hashable, Codable {
    let analysisStatus: PolicyAnalysisStatus
    let presentationTier: PresentationTier
    let canonicalTitleJA, canonicalTitleEN, changeSummaryJA, whyItMattersJA, policyType: String?
    let policyDomainCodes: [String]
    let primaryAgencyCode: String?
    let affectedRegionCodes, affectedSectorCodes, affectedProductTerms: [String]
    let marketAnalysisMode: MarketAnalysisMode
    let marketRelevanceReasonJA, noCompanyReasonJA, noMarketDataReasonJA: String?
    let analysisVersion: Int
    let reviewedAt, publishedAt: Date?
    let companyRelations: [PolicyCompanyRelation]

    static func fallback(for event: PolicyEvent) -> PolicyAnalysis {
        if event.isSynthetic { return synthetic(for: event) }
        return PolicyAnalysis(
            analysisStatus: .unreviewed, presentationTier: .archive, canonicalTitleJA: nil,
            canonicalTitleEN: event.titleEN, changeSummaryJA: nil, whyItMattersJA: nil,
            policyType: event.instrumentType?.rawValue, policyDomainCodes: event.policyDomain.map { [$0.slug] } ?? [],
            primaryAgencyCode: event.agency.code, affectedRegionCodes: [], affectedSectorCodes: [], affectedProductTerms: [],
            marketAnalysisMode: .unmapped, marketRelevanceReasonJA: "政策と市場の関連性を確認中です。",
            noCompanyReasonJA: nil, noMarketDataReasonJA: nil, analysisVersion: 0, reviewedAt: nil, publishedAt: nil,
            companyRelations: []
        )
    }

    private static func synthetic(for event: PolicyEvent) -> PolicyAnalysis {
        let configuration: (PresentationTier, MarketAnalysisMode, [String], [String], String) = switch event.agency.code {
        case "BIS": (.signal, .intraday, ["CN", "MO"], ["Semiconductors"], "先端計算用半導体と製造装置")
        case "WH": (.signal, .disabled, ["US"], ["Semiconductors"], "半導体製造投資")
        case "USTR": (.monitor, .daily, ["US", "CN"], ["Semiconductors"], "特定半導体製品")
        default: (.archive, .notApplicable, ["US"], ["Government programs"], "補助金採択文書")
        }
        let marketReason = configuration.1 == .intraday ? "公式公開時刻と関連候補を確認できるため、デモの分足比較を表示します。" : configuration.1 == .daily ? "掲載日単位のため日足で確認します。" : nil
        let noMarketReason = configuration.1 == .disabled ? "デモ環境では市場データ機能を無効にしています。" : configuration.1 == .notApplicable ? "事務的な文書更新のため市場評価対象外です。" : nil
        return PolicyAnalysis(
            analysisStatus: .automatedDraft, presentationTier: configuration.0, canonicalTitleJA: event.titleJA,
            canonicalTitleEN: event.titleEN, changeSummaryJA: event.summaryJA,
            whyItMattersJA: configuration.0 == .archive ? "記録と検索のため保存しています。" : "対象分野の制度条件や実務判断に影響し得るため、公式資料の更新を追跡します。",
            policyType: event.instrumentType?.rawValue ?? event.status.rawValue,
            policyDomainCodes: event.policyDomain.map { [$0.slug] } ?? [event.category.rawValue],
            primaryAgencyCode: event.agency.code, affectedRegionCodes: configuration.2, affectedSectorCodes: configuration.3,
            affectedProductTerms: [configuration.4], marketAnalysisMode: configuration.1,
            marketRelevanceReasonJA: marketReason, noCompanyReasonJA: event.exposures.isEmpty ? "公式資料から個別企業を特定していません。" : nil,
            noMarketDataReasonJA: noMarketReason, analysisVersion: 1, reviewedAt: nil, publishedAt: nil, companyRelations: []
        )
    }
}

struct TimelineItem: Identifiable, Hashable, Codable {
    let id: UUID
    let kind: TimelineItemKind
    let occurredAt: Date
    let titleJA, detailJA: String
    let sourceType: SourceType
    let verificationState: VerificationState
    let documentVersion: Int?
    let documentID: UUID?
}

struct EvidenceReference: Hashable, Codable { let labelJA, valueJA: String }

struct CompanyExposure: Identifiable, Hashable, Codable {
    let id: UUID
    let ticker, companyName: String
    let relationship: ExposureRelationship
    let evidenceJA: String
    let verificationState: VerificationState
    let references: [EvidenceReference]
}

struct MarketSummary: Identifiable, Hashable, Codable {
    var id: String { "\(window.rawValue)-\(ticker)" }
    let window: ReactionWindow
    let availableAt: Date
    let ticker, benchmarkTicker: String
    let securityReturn, benchmarkReturn, abnormalReturn: Double
    let maxVolumeRatio: Double
    let abnormalReactionDetected: Bool
}

struct MarketPoint: Identifiable, Hashable, Codable {
    var id: Date { timestamp }
    let timestamp: Date
    let normalizedSecurityPrice, normalizedBenchmarkPrice: Double
    let abnormalReturnPoints, volumeRatio: Double
}

struct Confounder: Identifiable, Hashable, Codable { let id: UUID; let titleJA: String; let occurredAt: Date; let availableAt: Date?; let relevance, detailJA: String }
struct ImportantClause: Identifiable, Hashable, Codable { let id: UUID; let textJA: String; let sourceURL: URL? }
struct ContentHash: Hashable, Codable {
    let algorithm: String
    let value: String
    let scope: String?

    init(algorithm: String, value: String, scope: String? = nil) {
        self.algorithm = algorithm
        self.value = value
        self.scope = scope
    }

    var isValidSHA256: Bool {
        algorithm == "sha256" && value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
    }
}
struct DocumentInfo: Hashable, Codable { let documentNumber, publisherJA, publisherEN: String; let currentVersion: Int; let contentHash: ContentHash }
struct DocumentVersion: Hashable, Codable { let version: Int; let publishedAt: Date; let titleJA, bodyJA, bodyEN: String }
enum DocumentType: String, Hashable, Codable { case finalRule = "final_rule", proposedRule = "proposed_rule", presidentialDocument = "presidential_document", correctingAmendment = "correcting_amendment", notice, other }
enum DocumentRelationship: String, Hashable, Codable { case primary, corrects, related }
enum AvailabilityBasis: String, Hashable, Codable { case sourceStated = "source_stated", firstObserved = "first_observed", publicationDateOnly = "publication_date_only", manualEstimate = "manual_estimate" }
enum TimePrecision: String, Hashable, Codable { case exact, minute, hour, day }
struct PolicyDocument: Identifiable, Hashable, Codable {
    let id: UUID
    let documentType: DocumentType
    let relationship: DocumentRelationship
    let correctsDocumentID: UUID?
    let documentNumber, publisherJA, publisherEN, titleJA, titleEN: String
    let officialURL: URL?
    let publishedOn, effectiveOn, applicableOn, commentsCloseOn, sourceStatedAt, sourceStatedTimezone: String?
    let firstObservedAt, ingestedAt, availableAt: Date
    let availabilityBasis: AvailabilityBasis
    let timePrecision: TimePrecision
    let currentRevision: Int
    let contentHash: ContentHash
    let bodyJA, bodyEN: String
    let govInfoPDFURL, publicInspectionPDFURL: URL?
    let docketIDs, regulationIDNumbers, cfrReferences: [String]?

    var typeLabel: String {
        switch documentType { case .finalRule: "原規則"; case .proposedRule: "規則案"; case .presidentialDocument: "大統領文書"; case .correctingAmendment: "訂正文書"; case .notice: "告示"; case .other: "公式文書" }
    }
}
struct DocumentRelationshipCandidate: Identifiable, Hashable, Codable {
    let id: UUID
    let fromDocumentID: UUID
    let fromDocumentNumber: String?
    let toDocumentID: UUID
    let toDocumentNumber: String?
    let relationship: String
    let confidence: Double?
    let reviewState: String

    var relationshipLabelJA: String {
        let suffix = reviewState == "approved" ? "" : "候補"
        return switch relationship {
        case "corrects": "訂正\(suffix)"
        case "amends": "修正\(suffix)"
        case "rescinds": "撤回\(suffix)"
        case "supersedes": "置換\(suffix)"
        case "implements": "実施関係\(suffix)"
        case "supports": "補足資料\(suffix)"
        case "cites": "引用関係\(suffix)"
        case "same_docket": "同一Docket\(suffix)"
        default: "関連\(suffix)"
        }
    }
}
struct DocumentDiff: Hashable, Codable { let deletedJA, addedJA, deletedEN, addedEN: [String] }
struct CorrectionNote: Identifiable, Hashable, Codable { let id: UUID; let occurredAt: Date; let availableAt: Date?; let detailJA: String }

struct ReplaySnapshot: Hashable {
    let asOf: Date
    let visibleTimelineItems: [TimelineItem]
    let activeDocumentVersion: DocumentVersion?
    let visibleDocuments: [PolicyDocument]
    let visibleMarketPoints: [MarketPoint]
    let visibleConfounders: [Confounder]
    let visibleCorrections: [CorrectionNote]
    let availableMarketSummaries: [MarketSummary]
    let unavailableLaterFactsCount: Int
}

enum ReplayMilestone: String, CaseIterable, Identifiable {
    case beforePublication, officialPublication, firstReport, revision, marketReaction
    var id: Self { self }
    var title: String {
        switch self {
        case .beforePublication: "公開前"
        case .officialPublication: "公式公開"
        case .firstReport: "最初の報道"
        case .revision: "改訂・訂正"
        case .marketReaction: "市場データ"
        }
    }
}

enum TimezonePreference: String, CaseIterable, Identifiable {
    case et = "ET", jst = "JST", both = "両方"
    var id: Self { self }
}

enum APIDataMode: String, Codable { case synthetic, live, mixed }

struct APIEnvelope<Value: Codable>: Codable {
    let dataMode: APIDataMode
    let data: Value
    let pagination: APIPagination?

    init(dataMode: APIDataMode, data: Value, pagination: APIPagination? = nil) {
        self.dataMode = dataMode
        self.data = data
        self.pagination = pagination
    }
}

struct APIPagination: Codable {
    let total, limit: Int
    let cursor, nextCursor: String?
}

struct PublicationGroupingMetadata: Hashable, Codable {
    let documentNumber: String?
    let docketIDs, regulationIDNumbers, cfrReferences: [String]
}

enum PolicyLegalDateKind: String, Hashable, Codable {
    case commentsClose = "comments_close"
    case effective
    case applicable
}

struct PolicyLegalDateSummary: Identifiable, Hashable, Codable {
    let kind: PolicyLegalDateKind
    let date: String
    let documentID: UUID
    let documentNumber: String?
    let officialURL: URL?

    var id: String { "\(kind.rawValue):\(date):\(documentID.uuidString)" }
}

struct PolicyEventSummary: Identifiable, Hashable, Codable {
    let id: UUID
    let agency: Agency
    let titleJA, titleEN, summaryJA: String
    let topics, tickers: [String]
    let status: EventStatus
    let lastActivityAt: Date
    let publishedAt, revisedAt, marketEvaluationAvailableAt: Date?
    let hasMarketData: Bool
    let timelineItemCount, updateCount, relatedDocumentCount, confounderCount: Int
    let hasCorrectionDocument: Bool
    let coverageState: CoverageState?
    let verificationState: EventVerificationState?
    let instrumentType: PolicyInstrumentType?
    let domain: PolicyDomainReference?
    let analysis: PolicyAnalysis?
    let translation: PolicyTranslation?
    var publicationGrouping: PublicationGroupingMetadata? = nil
    var legalDates: [PolicyLegalDateSummary]? = nil

    var anchorDate: Date { publishedAt ?? lastActivityAt }
    var productAnalysis: PolicyAnalysis {
        analysis ?? PolicyAnalysis(
            analysisStatus: .unreviewed, presentationTier: .archive, canonicalTitleJA: nil, canonicalTitleEN: titleEN,
            changeSummaryJA: nil, whyItMattersJA: nil, policyType: instrumentType?.rawValue,
            policyDomainCodes: domain.map { [$0.slug] } ?? [], primaryAgencyCode: agency.code,
            affectedRegionCodes: [], affectedSectorCodes: [], affectedProductTerms: [], marketAnalysisMode: .unmapped,
            marketRelevanceReasonJA: "政策と市場の関連性を確認中です。", noCompanyReasonJA: nil, noMarketDataReasonJA: nil,
            analysisVersion: 0, reviewedAt: nil, publishedAt: nil, companyRelations: []
        )
    }
}

struct EventDetailPayload: Codable {
    let id: UUID
    let isSynthetic: Bool
    let lastActivityAt: Date
    let agency: Agency
    let titleJA, titleEN, summaryJA: String
    let topics, tickers: [String]
    let category: PolicyCategory
    let status: EventStatus
    let timestampState: TimestampState
    let analysisAnchor: AnalysisAnchor
    let officialPublicationDate: String?
    let publishedAt, detectedAt, revisedAt: Date?
    let sourceURL: URL?
    let exposures: [CompanyExposure]
    let marketSummaries: [MarketSummary]
    let confounders: [Confounder]
    let confounderReviewState: ConfounderReviewState?
    let importantClauses: [ImportantClause]?
    let coverageState: CoverageState?
    let eventVerificationState: EventVerificationState?
    let instrumentType: PolicyInstrumentType?
    let policyDomain: PolicyDomainReference?
    let analysis: PolicyAnalysis?
    let translation: PolicyTranslation?
}

struct EvidencePayload: Codable {
    let documentInfo: DocumentInfo
    let documentVersions: [DocumentVersion]
    let documents: [PolicyDocument]?
    let relationshipCandidates: [DocumentRelationshipCandidate]?
    let documentDiff: DocumentDiff?
    let exposures: [CompanyExposure]
    let confounders: [Confounder]
    let correctionNotes: [CorrectionNote]
}

struct MarketDataProvenance: Hashable, Codable {
    let provider, licenseMode, attribution: String
    let delayStatus: String?
}

struct MarketPayload: Codable {
    let series: [MarketPoint]
    let evaluations: [MarketSummary]
    let provider, licenseMode, attribution: String
    let delayStatus: String?

    var provenance: MarketDataProvenance {
        MarketDataProvenance(provider: provider, licenseMode: licenseMode, attribution: attribution, delayStatus: delayStatus)
    }
}

struct ReplayPayload: Codable {
    let eventId: UUID
    let asOf: Date
    let timelineItems: [TimelineItem]
    let documentVersion: DocumentVersion?
    let documents: [PolicyDocument]?
    let marketSeries: [MarketPoint]
    let marketSummaries: [MarketSummary]
    let confounders: [Confounder]
    let correctionNotes: [CorrectionNote]
    let laterFactCount: Int
}
