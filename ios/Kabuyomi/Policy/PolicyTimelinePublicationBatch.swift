import Foundation
import SwiftUI

enum TimelinePublicationBatchKind: String, Hashable {
    case policySeries
    case documentFamily
    case coordinatedRelease

    var labelJA: String {
        switch self {
        case .policySeries: "政策系列"
        case .documentFamily: "訂正・改訂"
        case .coordinatedRelease: "一括公示"
        }
    }

    var systemImage: String {
        switch self {
        case .policySeries: "point.3.connected.trianglepath.dotted"
        case .documentFamily: "doc.on.doc"
        case .coordinatedRelease: "rectangle.stack"
        }
    }
}

struct TimelinePublicationBatch: Identifiable, Hashable {
    let id: String
    let kind: TimelinePublicationBatchKind
    let agencyCode: String
    let publicationDay: Date
    let titleJA: String
    let summaryJA: String
    let groupingBasisJA: String
    let events: [PolicyEventSummary]
}

enum TimelinePublicationItem: Identifiable, Hashable {
    case event(PolicyEventSummary)
    case batch(TimelinePublicationBatch)

    var id: String {
        switch self {
        case .event(let event): "event:\(event.id.uuidString)"
        case .batch(let batch): batch.id
        }
    }
}

enum TimelinePublicationGrouper {
    private enum OfficialIdentifierKind: String {
        case docket
        case rin
    }

    private enum CoordinatedActionKind: String, CaseIterable {
        case commentPeriod
        case armsSales
        case cooperativeResearch
        case informationCollection
        case selfRegulatoryRuleChange
        case sanctions
        case combinedFilings

        var minimumCount: Int {
            switch self {
            case .armsSales, .sanctions, .combinedFilings: 2
            default: 3
            }
        }
    }

    private struct ActionMatch {
        let kind: CoordinatedActionKind
        let dayCount: Int?
    }

    private struct CohortKey: Hashable {
        let agencyCode: String
        let day: String
        let instrument: String
        let domain: String

        var description: String { "\(agencyCode):\(day):\(instrument):\(domain)" }
    }

    private struct Candidate {
        let key: String
        let kind: TimelinePublicationBatchKind
        let agencyCode: String
        let titleJA: String
        let summaryJA: String
        let groupingBasisJA: String
        let events: [PolicyEventSummary]
    }

    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    static func items(from events: [PolicyEventSummary]) -> [TimelinePublicationItem] {
        let batches = publicationBatches(from: events)
        let batchByEvent = Dictionary(uniqueKeysWithValues: batches.flatMap { batch in
            batch.events.map { ($0.id, batch) }
        })
        var emitted = Set<String>()
        var result: [TimelinePublicationItem] = []

        for event in events {
            guard let batch = batchByEvent[event.id] else {
                result.append(.event(event))
                continue
            }
            if emitted.insert(batch.id).inserted { result.append(.batch(batch)) }
        }
        return result
    }

    static func publicationBatches(from events: [PolicyEventSummary]) -> [TimelinePublicationBatch] {
        var remaining = events
        var batches: [TimelinePublicationBatch] = []

        consume(billSeriesCandidates(from: remaining), remaining: &remaining, batches: &batches)
        consume(documentFamilyCandidates(from: remaining), remaining: &remaining, batches: &batches)
        consume(coordinatedActionCandidates(from: remaining), remaining: &remaining, batches: &batches)
        consume(identifierCandidates(from: remaining, kind: .docket), remaining: &remaining, batches: &batches)
        consume(identifierCandidates(from: remaining, kind: .rin), remaining: &remaining, batches: &batches)
        consume(exactTitleCandidates(from: remaining), remaining: &remaining, batches: &batches)

        return batches.sorted {
            if $0.publicationDay != $1.publicationDay { return $0.publicationDay > $1.publicationDay }
            return $0.titleJA.localizedStandardCompare($1.titleJA) == .orderedAscending
        }
    }

    private static func consume(
        _ candidates: [Candidate],
        remaining: inout [PolicyEventSummary],
        batches: inout [TimelinePublicationBatch]
    ) {
        var availableIDs = Set(remaining.map(\.id))
        for candidate in candidates.sorted(by: candidateOrder) {
            guard candidate.events.allSatisfy({ availableIDs.contains($0.id) }) else { continue }
            let members = sortedMembers(candidate.events)
            guard members.count >= 2 else { continue }
            let latest = members.map(\.lastActivityAt).max() ?? members[0].lastActivityAt
            let batch = TimelinePublicationBatch(
                id: "publication-batch:\(candidate.kind.rawValue):\(stableID(candidate.key))",
                kind: candidate.kind,
                agencyCode: candidate.agencyCode,
                publicationDay: latest,
                titleJA: candidate.titleJA,
                summaryJA: candidate.summaryJA,
                groupingBasisJA: candidate.groupingBasisJA,
                events: members
            )
            batches.append(batch)
            members.forEach { availableIDs.remove($0.id) }
        }
        remaining.removeAll { !availableIDs.contains($0.id) }
    }

    private static func candidateOrder(_ lhs: Candidate, _ rhs: Candidate) -> Bool {
        if lhs.events.count != rhs.events.count { return lhs.events.count > rhs.events.count }
        return lhs.key < rhs.key
    }

    private static func billSeriesCandidates(from events: [PolicyEventSummary]) -> [Candidate] {
        let keyed = events.compactMap { event -> (String, PolicyEventSummary)? in
            guard [.legislativeBillResolution, .committeeActionHearing].contains(event.instrumentType),
                  let identifier = billIdentifier(for: event) else { return nil }
            return (identifier, event)
        }
        return Dictionary(grouping: keyed, by: \.0).compactMap { identifier, values in
            let members = uniqueEvents(values.map(\.1))
            guard members.count >= 2 else { return nil }
            let agencies = Set(members.map(\.displayAgencyCode))
            let agency = agencies.count == 1 ? agencies.first! : "連邦議会"
            return Candidate(
                key: "bill:\(identifier)",
                kind: .policySeries,
                agencyCode: agency,
                titleJA: "\(identifier)の動きを\(members.count)件の資料で追跡",
                summaryJA: "同じ法案・決議番号の提出、委員会審議、修正、採決などを時系列でまとめています。",
                groupingBasisJA: "法案・決議番号 \(identifier)",
                events: members
            )
        }
    }

    private static func identifierCandidates(
        from events: [PolicyEventSummary],
        kind: OfficialIdentifierKind
    ) -> [Candidate] {
        let keyed = events.flatMap { event -> [(String, PolicyEventSummary)] in
            let values: [String]
            switch kind {
            case .docket: values = event.publicationGrouping?.docketIDs ?? []
            case .rin: values = event.publicationGrouping?.regulationIDNumbers ?? []
            }
            return values.compactMap { raw in
                guard let normalized = normalizedOfficialIdentifier(raw) else { return nil }
                return ("\(event.agency.code)|\(normalized)", event)
            }
        }

        return Dictionary(grouping: keyed, by: \.0).compactMap { compoundKey, values in
            let members = uniqueEvents(values.map(\.1))
            guard members.count >= 2 else { return nil }
            let identifier = compoundKey.split(separator: "|", maxSplits: 1).last.map(String.init) ?? compoundKey
            let agency = members[0].displayAgencyCode
            let label = kind == .docket ? "Docket" : "RIN"
            let title = kind == .docket
                ? "\(agency)、同一Docketの関連資料\(members.count)件"
                : "\(agency)、同一規則制定の関連資料\(members.count)件"
            return Candidate(
                key: "\(kind.rawValue):\(compoundKey)",
                kind: .policySeries,
                agencyCode: agency,
                titleJA: title,
                summaryJA: "同じ公式識別子を持つ公示を時系列でまとめています。各文書の法的状態と原文は個別に確認できます。",
                groupingBasisJA: "同一\(label) \(identifier)",
                events: members
            )
        }
    }

    private static func documentFamilyCandidates(from events: [PolicyEventSummary]) -> [Candidate] {
        let keyed = events.compactMap { event -> (String, Bool, PolicyEventSummary)? in
            guard let titleInfo = followUpTitleInfo(for: event) else { return nil }
            return ("\(event.agency.code)|\(titleInfo.base)", titleInfo.isFollowUp, event)
        }
        return Dictionary(grouping: keyed, by: \.0).compactMap { key, values in
            let members = uniqueEvents(values.map(\.2))
            guard members.count >= 2, values.contains(where: { $0.1 }) else { return nil }
            let dates = members.map(\.lastActivityAt)
            guard let first = dates.min(), let last = dates.max(),
                  last.timeIntervalSince(first) <= 730 * 86_400 else { return nil }
            let agency = members[0].displayAgencyCode
            return Candidate(
                key: "document-family:\(key)",
                kind: .documentFamily,
                agencyCode: agency,
                titleJA: "\(agency)、訂正・改訂を含む一連の資料\(members.count)件",
                summaryJA: "原文タイトルと公式な訂正・改訂表記が一致する文書を時系列でまとめています。",
                groupingBasisJA: "同一原題と訂正・改訂表記",
                events: members
            )
        }
    }

    private static func coordinatedActionCandidates(from events: [PolicyEventSummary]) -> [Candidate] {
        Dictionary(grouping: events, by: cohortKey).values.flatMap { cohort -> [Candidate] in
            let matches = cohort.compactMap { event in actionMatch(for: event).map { ($0, event) } }
            let grouped = Dictionary(grouping: matches, by: { $0.0.kind })
            return grouped.compactMap { kind, values in
                var members = uniqueEvents(values.map(\.1))
                guard members.count >= kind.minimumCount else { return nil }

                let classifiedShare = Double(members.count) / Double(max(cohort.count, 1))
                if kind == .commentPeriod, grouped.count == 1, classifiedShare >= 0.60 {
                    let untranslated = cohort.filter(isUntranslatedSourceRecord)
                    members = uniqueEvents(members + untranslated)
                }

                let agency = agencyLabel(for: members, action: kind)
                let title = coordinatedTitle(
                    action: kind,
                    agency: agency,
                    members: members,
                    dayCounts: values.compactMap { $0.0.dayCount }
                )
                return Candidate(
                    key: "coordinated:\(cohortKey(for: members[0]).description):\(kind.rawValue)",
                    kind: .coordinatedRelease,
                    agencyCode: agency,
                    titleJA: title,
                    summaryJA: coordinatedSummary(action: kind),
                    groupingBasisJA: "同日・同機関・同一手続き",
                    events: members
                )
            }
        }
    }

    private static func exactTitleCandidates(from events: [PolicyEventSummary]) -> [Candidate] {
        let keyed = events.compactMap { event -> (String, PolicyEventSummary)? in
            guard let title = normalizedExactTitle(event.titleEN.nonEmpty ?? event.titleJA) else { return nil }
            return ("\(cohortKey(for: event).description)|\(title)", event)
        }
        return Dictionary(grouping: keyed, by: \.0).compactMap { key, values in
            let members = uniqueEvents(values.map(\.1))
            guard members.count >= 2 else { return nil }
            let agency = members[0].displayAgencyCode
            return Candidate(
                key: "same-title:\(key)",
                kind: .coordinatedRelease,
                agencyCode: agency,
                titleJA: "\(agency)、同一様式の公式資料\(members.count)件",
                summaryJA: "同日に同じ公式タイトルで公示された資料を一覧上だけまとめています。対象と原文は個別に確認できます。",
                groupingBasisJA: "同日・同機関・同一公式タイトル",
                events: members
            )
        }
    }

    private static func cohortKey(for event: PolicyEventSummary) -> CohortKey {
        CohortKey(
            agencyCode: event.agency.code,
            day: publicationDayKey(event.lastActivityAt),
            instrument: event.instrumentType?.rawValue ?? "unknown",
            domain: event.domain?.slug ?? "unknown"
        )
    }

    private static func actionMatch(for event: PolicyEventSummary) -> ActionMatch? {
        let title = normalizedText(event.titleEN)
        let text = normalizedText("\(event.titleJA) \(event.titleEN) \(event.summaryJA)")

        if title.contains("arms sales notification") {
            return ActionMatch(kind: .armsSales, dayCount: nil)
        }
        if title.contains("notice pursuant to the national cooperative research and production act") {
            return ActionMatch(kind: .cooperativeResearch, dayCount: nil)
        }
        if title.hasPrefix("combined notice of filings") {
            return ActionMatch(kind: .combinedFilings, dayCount: nil)
        }
        if event.instrumentType == .sanctionsDesignation || title.contains("sanctions action") {
            return ActionMatch(kind: .sanctions, dayCount: nil)
        }
        if title.contains("self regulatory organizations") {
            return ActionMatch(kind: .selfRegulatoryRuleChange, dayCount: nil)
        }
        let informationCollectionTerms = [
            "agency information collection",
            "submission for omb review",
            "information collection being submitted",
            "reporting and recordkeeping requirements under omb review",
            "data collection available for public comments"
        ]
        if informationCollectionTerms.contains(where: title.contains) {
            return ActionMatch(kind: .informationCollection, dayCount: nil)
        }

        let hasComment = ["comment period", "public comment", "comments", "意見", "コメント", "公聴"].contains {
            text.contains($0)
        }
        let hasChange = [
            "reopen",
            "extend",
            "extension",
            "additional comment period",
            "additional public comment",
            "再開",
            "延長",
            "追加の意見",
            "追加コメント",
            "追加のコメント",
            "追加の公聴",
            "追加公聴",
            "追加の公述",
            "追加の公的意見",
            "再設定"
        ].contains {
            text.contains($0)
        }
        if hasComment && hasChange {
            return ActionMatch(kind: .commentPeriod, dayCount: extractedDayCount(from: text))
        }
        return nil
    }

    private static func coordinatedTitle(
        action: CoordinatedActionKind,
        agency: String,
        members: [PolicyEventSummary],
        dayCounts: [Int]
    ) -> String {
        let count = members.count
        switch action {
        case .commentPeriod:
            let distinctDays = Set(dayCounts)
            if distinctDays.count == 1, let days = distinctDays.first {
                let instrument = members.first?.instrumentType?.labelJA ?? "資料"
                return "\(agency)、\(count)件の\(instrument)で意見募集を\(days)日延長"
            }
            return "\(agency)、\(count)件の資料で意見募集を延長・再開"
        case .armsSales:
            return "\(agency)、武器売却通知を\(count)件公示"
        case .cooperativeResearch:
            return "\(agency)、共同研究・生産法に基づく届出を\(count)件公示"
        case .informationCollection:
            return "\(agency)、情報収集手続きの公示を\(count)件まとめて表示"
        case .selfRegulatoryRuleChange:
            return "\(agency)、自主規制機関の規則変更資料を\(count)件公示"
        case .sanctions:
            return "\(agency)、制裁措置の公示を\(count)件まとめて表示"
        case .combinedFilings:
            return "\(agency)、提出資料の一括公示を\(count)件まとめて表示"
        }
    }

    private static func coordinatedSummary(action: CoordinatedActionKind) -> String {
        switch action {
        case .commentPeriod:
            "同日に公示された同一手続きの資料をまとめています。各資料のDocket／RINと原文は個別に確認できます。"
        default:
            "同日に同じ種類の手続きとして公示された資料を一覧上だけまとめています。内容と原文は個別に確認できます。"
        }
    }

    private static func agencyLabel(
        for events: [PolicyEventSummary],
        action: CoordinatedActionKind
    ) -> String {
        guard let first = events.first else { return "機関" }
        if action == .commentPeriod,
           first.agency.code == "DOL",
           events.contains(where: { normalizedText($0.summaryJA).contains("osha") }) {
            return "OSHA"
        }
        return first.displayAgencyCode
    }

    private static func billIdentifier(for event: PolicyEventSummary) -> String? {
        let source = "\(event.titleEN) \(event.titleJA) \(event.summaryJA)"
        let pattern = #"(?i)\b(H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|S\.?\s*Con\.?\s*Res\.?|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*R\.?|S\.?)\s*(\d+)\b"#
        guard let match = firstMatch(pattern: pattern, in: source), match.numberOfRanges >= 3,
              let prefixRange = Range(match.range(at: 1), in: source),
              let numberRange = Range(match.range(at: 2), in: source) else { return nil }
        let rawPrefix = source[prefixRange].uppercased().replacingOccurrences(
            of: #"[\s.]"#,
            with: "",
            options: .regularExpression
        )
        let prefix = switch rawPrefix {
        case "HR": "H.R."
        case "S": "S."
        case "HJRES": "H.J.Res."
        case "SJRES": "S.J.Res."
        case "HCONRES": "H.Con.Res."
        case "SCONRES": "S.Con.Res."
        case "HRES": "H.Res."
        case "SRES": "S.Res."
        default: rawPrefix
        }
        let number = String(source[numberRange])
        let year = utcCalendar.component(.year, from: event.lastActivityAt)
        let congress = max(1, ((year - 1789) / 2) + 1)
        return "\(prefix) \(number)・第\(congress)議会"
    }

    private static func followUpTitleInfo(
        for event: PolicyEventSummary
    ) -> (base: String, isFollowUp: Bool)? {
        guard let source = event.titleEN.nonEmpty ?? event.titleJA.nonEmpty else { return nil }
        var base = source
        let prefixPattern = #"(?i)^\s*(?:correction|correcting amendment|technical amendment)\s+(?:to|for)\s+"#
        let suffixPattern = #"(?i)\s*[;,:—–-]\s*(?:correction|correcting amendment|technical amendment|amendment|withdrawal|delay of effective date|extension of (?:the )?comment period|reopening of (?:the )?comment period)\s*$"#
        let prefixed = base.range(of: prefixPattern, options: .regularExpression) != nil
        let suffixed = base.range(of: suffixPattern, options: .regularExpression) != nil
        base = base.replacingOccurrences(of: prefixPattern, with: "", options: .regularExpression)
        base = base.replacingOccurrences(of: suffixPattern, with: "", options: .regularExpression)
        base = base.replacingOccurrences(
            of: #"(?i)\s*[;,:—–-]\s*(?:final rule|proposed rule)\s*$"#,
            with: "",
            options: .regularExpression
        )
        guard let normalized = normalizedExactTitle(base) else { return nil }
        let isFollowUp = prefixed || suffixed || event.instrumentType == .correctingAmendment || event.status.isFollowUp
        return (normalized, isFollowUp)
    }

    private static func normalizedOfficialIdentifier(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard value.count >= 4, !["NONE", "N/A", "UNKNOWN"].contains(value) else { return nil }
        return value
    }

    private static func normalizedExactTitle(_ source: String?) -> String? {
        guard var value = source?.nonEmpty else { return nil }
        value = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        value = value.replacingOccurrences(of: #"(?i)\s*#\s*\d+\s*$"#, with: "", options: .regularExpression)
        value = value.replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
        value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 8 else { return nil }
        return value
    }

    private static func normalizedText(_ source: String) -> String {
        source
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: #"[_\p{P}\p{S}]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractedDayCount(from text: String) -> Int? {
        let pattern = #"(?i)(\d{1,3})\s*(?:日|[-‐‑–— ]*days?)"#
        guard let match = firstMatch(pattern: pattern, in: text), match.numberOfRanges >= 2,
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return Int(text[range])
    }

    private static func firstMatch(pattern: String, in source: String) -> NSTextCheckingResult? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(
                in: source,
                range: NSRange(source.startIndex..<source.endIndex, in: source)
              ) else { return nil }
        return match
    }

    private static func isUntranslatedSourceRecord(_ event: PolicyEventSummary) -> Bool {
        event.translation == nil
            && (event.titleJA.localizedCaseInsensitiveCompare(event.titleEN) == .orderedSame
                || event.summaryJA.hasPrefix("公式ソース確認済み"))
    }

    private static func sortedMembers(_ events: [PolicyEventSummary]) -> [PolicyEventSummary] {
        events.sorted {
            if $0.lastActivityAt != $1.lastActivityAt { return $0.lastActivityAt > $1.lastActivityAt }
            return $0.titleEN.localizedStandardCompare($1.titleEN) == .orderedAscending
        }
    }

    private static func uniqueEvents(_ events: [PolicyEventSummary]) -> [PolicyEventSummary] {
        var byID: [UUID: PolicyEventSummary] = [:]
        events.forEach { byID[$0.id] = $0 }
        return Array(byID.values)
    }

    private static func publicationDayKey(_ date: Date) -> String {
        let components = utcCalendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }

    private static func stableID(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }
}

struct TimelinePublicationBatchRow: View {
    let batch: TimelinePublicationBatch
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var accessibilityLayout: Bool { dynamicTypeSize.isAccessibilitySize }
    private var commonDomainLabel: String? {
        let values = Set(batch.events.compactMap { $0.domain?.labelJA.nonEmpty })
        return values.count == 1 ? values.first : nil
    }
    private var translatedCount: Int {
        batch.events.filter { $0.translation != nil }.count
    }
    private var translationCoverageLabel: String {
        if translatedCount == 0 { return "日本語未作成" }
        if translatedCount == batch.events.count { return "日本語 \(translatedCount)件" }
        return "日本語 \(translatedCount)/\(batch.events.count)件"
    }
    private var memberPreview: String {
        let titles = batch.events.prefix(3).map(\.displayTitleJA)
        let remainder = batch.events.count - titles.count
        return titles.joined(separator: " / ") + (remainder > 0 ? " ほか\(remainder)件" : "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            topLine
            HStack(spacing: 8) {
                Label("\(batch.events.count)件をまとめて表示", systemImage: batch.kind.systemImage)
                    .foregroundStyle(KabuyomiTheme.accent)
                Label(translationCoverageLabel, systemImage: "globe")
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .font(.caption2.weight(.semibold))
            Text(batch.titleJA)
                .font(.headline)
                .lineLimit(accessibilityLayout ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
            Text(batch.summaryJA)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .lineLimit(accessibilityLayout ? nil : 2)
            Text("内訳  " + memberPreview)
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .lineLimit(accessibilityLayout ? nil : 2)
            footer
        }
        .padding(.vertical, 9)
        .frame(
            minHeight: accessibilityLayout ? nil : TimelineRowMetrics.standardMinimumHeight,
            alignment: .topLeading
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(batch.kind.labelJA)、\(batch.titleJA)、個別資料\(batch.events.count)件、\(translationCoverageLabel)"
        )
    }

    @ViewBuilder
    private var topLine: some View {
        if accessibilityLayout {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    dateAndAgency
                    Spacer(minLength: 4)
                    kindLabel
                }
                if let commonDomainLabel {
                    Text(commonDomainLabel)
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                dateAndAgency
                if let commonDomainLabel {
                    Text(commonDomainLabel)
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                kindLabel
            }
        }
    }

    private var dateAndAgency: some View {
        Group {
            Text(batch.publicationDay.formatted(.dateTime.month(.twoDigits).day(.twoDigits)))
                .font(.caption.weight(.semibold).monospacedDigit())
            Text(batch.agencyCode)
                .font(.caption.weight(.bold))
        }
    }

    private var kindLabel: some View {
        Text(batch.kind.labelJA)
            .font(.caption.weight(.semibold))
            .foregroundStyle(KabuyomiTheme.inkMuted)
    }

    @ViewBuilder
    private var footer: some View {
        if accessibilityLayout {
            VStack(alignment: .leading, spacing: 3) {
                Text("資料 \(batch.events.count)件・個別記録")
                Label("市場評価は個別資料", systemImage: "chart.xyaxis.line")
            }
            .font(.caption2)
            .foregroundStyle(KabuyomiTheme.inkMuted)
        } else {
            HStack(spacing: 8) {
                Text("資料 \(batch.events.count)件・個別記録")
                Label("市場評価は個別資料", systemImage: "chart.xyaxis.line")
                Spacer(minLength: 2)
            }
            .font(.caption2)
            .foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }
}

struct TimelinePublicationBatchView: View {
    let batch: TimelinePublicationBatch

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("\(batch.events.count)件を自動でまとめています", systemImage: batch.kind.systemImage)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.accent)
                    Text(batch.titleJA).font(.title2.bold())
                    Text(batch.summaryJA).font(.subheadline).foregroundStyle(KabuyomiTheme.inkMuted)
                    LabeledContent("まとめた基準") {
                        Text(batch.groupingBasisJA)
                            .multilineTextAlignment(.trailing)
                    }
                    .font(.caption)
                    Text("法的には別々の資料です。内容を混ぜず、一覧だけをまとめています。")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                .padding(.vertical, 6)
            }

            Section("個別の公式資料  \(batch.events.count)件") {
                ForEach(batch.events) { event in
                    NavigationLink {
                        EventDetailLoader(summary: event)
                    } label: {
                        CompactPolicyRow(event: event)
                    }
                    .accessibilityIdentifier("publicationBatch.event.\(event.id.uuidString)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(batch.kind.labelJA)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("publicationBatch.detail")
    }
}
