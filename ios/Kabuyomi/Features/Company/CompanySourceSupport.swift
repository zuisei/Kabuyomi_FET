import Foundation

func investorFacingSourceLabel(for chunk: SourceChunkPayload, in company: CompanyPayload) -> String {
    if chunk.sectionType == "xbrl_metric" {
        if let tagName = chunk.tagName,
           let metric = company.metrics.first(where: { $0.tagUsed == tagName }) {
            return "\(MetricLabeler.title(for: metric.logicalName))（XBRL）"
        }
        return "主要指標（XBRL）"
    }

    let raw = chunk.sectionTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? chunk.sourceLabel : chunk.sectionTitle
    return investorFacingSourceLabel(rawLabel: raw, in: company)
}

func investorFacingSourceLabel(rawLabel: String, in company: CompanyPayload) -> String {
    let raw = rawLabel
        .replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard !raw.isEmpty else { return "提出資料" }

    let lowered = raw.lowercased()
    if lowered.range(of: #"^[a-z]?\d+$"#, options: .regularExpression) != nil {
        return "提出資料"
    }

    if lowered.contains("management's discussion") || lowered.contains("results of operations") || lowered.contains("md&a") {
        return "\(company.formType) MD&A"
    }

    if lowered.contains("risk factors") || lowered.contains("risk") {
        return "\(company.formType) リスク要因"
    }

    if let range = raw.range(of: #"Part\s+[IVXLC]+\s+Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
        return "\(company.formType) \(translatedItemLabel(from: String(raw[range])))"
    }

    if let range = raw.range(of: #"Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
        return "\(company.formType) \(translatedItemLabel(from: String(raw[range])))"
    }

    if lowered.contains("xbrl") {
        return "主要指標（XBRL）"
    }

    if let historicalMatch = raw.range(
        of: #"(10-[KQ])\s+filed\s+(\d{4}-\d{2}-\d{2})(?:\s+·\s+period\s+(\d{4}-\d{2}-\d{2}))?"#,
        options: .regularExpression
    ) {
        let label = String(raw[historicalMatch])
        let components = label.components(separatedBy: " · period ")
        let filed = components[0]
            .replacingOccurrences(of: " filed ", with: " 提出日 ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if components.count > 1 {
            return "\(filed) / 期末 \(components[1])"
        }
        return filed
    }

    if let range = raw.range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression), raw.count <= 24 {
        return "提出日 \(String(raw[range]))"
    }

    if raw.count > 24 {
        let endIndex = raw.index(raw.startIndex, offsetBy: 24)
        return String(raw[..<endIndex]) + "…"
    }

    return raw
}

private func translatedItemLabel(from raw: String) -> String {
    guard let match = raw.range(of: #"Item\s+\d+[A-Za-z]?"#, options: .regularExpression) else {
        return raw
    }

    return String(raw[match])
        .replacingOccurrences(of: "Item", with: "項目")
        .replacingOccurrences(of: "  ", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
