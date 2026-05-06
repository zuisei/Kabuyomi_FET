import Foundation

enum LegalSiteConfig {
    private static let baseURLString = "https://kabuyomi-legal-site.pages.dev"
    static let baseURL = URL(string: baseURLString)!

    static func url(pathComponent: String) -> URL? {
        URL(string: "\(baseURLString)/\(pathComponent)/")
    }
}
