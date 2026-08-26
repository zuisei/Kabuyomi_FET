import Foundation

enum AppFormatters {
    static let et = makeTimeFormatter(zone: "America/New_York")
    static let jst = makeTimeFormatter(zone: "Asia/Tokyo")
    static let etWithSeconds = makeTimeFormatter(zone: "America/New_York", seconds: true)
    static let jstWithSeconds = makeTimeFormatter(zone: "Asia/Tokyo", seconds: true)
    static let etHour = makeHourFormatter(zone: "America/New_York")
    static let jstHour = makeHourFormatter(zone: "Asia/Tokyo")
    static let etAudit = makeAuditFormatter(zone: "America/New_York")
    static let jstAudit = makeAuditFormatter(zone: "Asia/Tokyo")
    static let etMonthDay = makeMonthDayFormatter(zone: "America/New_York")
    static let jstMonthDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
        formatter.dateFormat = "M月d日"
        return formatter
    }()

    private static func makeMonthDayFormatter(zone: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "M/d"
        return formatter
    }

    private static func makeTimeFormatter(zone: String, seconds: Bool = false) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = seconds ? "HH:mm:ss" : "HH:mm"
        return formatter
    }

    private static func makeAuditFormatter(zone: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }

    private static func makeHourFormatter(zone: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "HH時台"
        return formatter
    }

    static func percent(_ value: Double) -> String { String(format: "%+.1f%%", value * 100) }
    static func points(_ value: Double) -> String { String(format: "%+.1fpt", value * 100) }
    static func pointsRaw(_ value: Double) -> String { String(format: "%+.1fpt", value) }
    static func displayTime(_ date: Date, preference: TimezonePreference) -> String {
        switch preference { case .et: "\(et.string(from: date)) ET"; case .jst: "\(jst.string(from: date)) JST"; case .both: "\(et.string(from: date)) ET / \(jst.string(from: date)) JST" }
    }
    static func auditTime(_ date: Date) -> String {
        "\(etAudit.string(from: date)) ET\n\(jstAudit.string(from: date)) JST"
    }
}
