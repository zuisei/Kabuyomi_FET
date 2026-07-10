import Foundation

enum LegalSiteConfig {
    private static let baseURLString = "https://kabuyomi-legal-site.pages.dev"
    static let baseURL = URL(string: baseURLString)!
    static let appleStandardEULAURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    static func url(pathComponent: String) -> URL? {
        URL(string: "\(baseURLString)/\(pathComponent)/")
    }

    static var privacyURL: URL? {
        url(pathComponent: "privacy")
    }

    static var termsURL: URL? {
        url(pathComponent: "terms")
    }
}
