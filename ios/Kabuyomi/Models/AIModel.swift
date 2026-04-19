import Foundation

enum AIModelName {
    static let local = "local"
    static let remoteFallback = "remote"

    static func storedRemoteModelName(_ responseModelName: String?) -> String {
        let trimmed = responseModelName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? remoteFallback : trimmed
    }

    static func storedLegacyModelName(_ responseModelName: String?) -> String {
        responseModelName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    static func compactLabel(for rawModelName: String) -> String? {
        let normalized = normalize(rawModelName)
        guard !normalized.isEmpty, normalized != local else { return nil }
        if normalized == remoteFallback {
            return "Remote AI"
        }

        let cleaned = normalized
            .replacingOccurrences(of: "models/", with: "")
            .split(separator: "-")
            .filter { !$0.isEmpty && $0 != "it" && $0 != "latest" }

        guard !cleaned.isEmpty else { return nil }
        return cleaned.map(formatToken).joined(separator: " ")
    }

    private static func normalize(_ rawModelName: String) -> String {
        rawModelName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private static func formatToken(_ token: Substring) -> String {
        let raw = String(token)

        if raw.contains(where: \.isNumber) && raw.contains(where: \.isLetter) {
            return raw.uppercased()
        }

        if raw.allSatisfy({ $0.isNumber || $0 == "." }) {
            return raw
        }

        return raw.localizedCapitalized
    }
}
