import Foundation

/// App Store への導線(共有・レビュー依頼)を1か所にまとめる。
///
/// 2026-08-24 の実測で、このアプリには**口コミの経路が存在しなかった**
/// (`ShareLink` 0件 / `requestReview` 0件、評価2件、実ユーザー4人)。
/// 転換率は正常でインプレッションだけが足りていないので、
/// 増やせる余地があるのは「外に出る導線」と「評価の数」の2つになる。
enum AppPromotion {
    static let appStoreAppID = "6762764426"

    private static let appStoreBaseURLString = "https://apps.apple.com/jp/app/kabuyomi/id\(appStoreAppID)"

    /// 流入元を App Store Connect の App Analytics(Campaigns)で切り分けるための
    /// キャンペーントークン付き URL。LP 側の CTA は `ct=lp` を使っている。
    /// トークンを付けないと、共有経由の入手と検索経由の入手が同じ数字に混ざる。
    static func appStoreURL(campaign: String) -> URL {
        URL(string: "\(appStoreBaseURLString)?ct=\(campaign)&mt=8") ?? URL(string: appStoreBaseURLString)!
    }

    /// 共有シートに載せる URL。
    static var shareURL: URL { appStoreURL(campaign: "app-share") }

    /// 共有本文の上限。SNS に貼られることを想定して、結論は途中で切る。
    static let sharedConclusionLimit = 140

    /// 回答を**アプリの外に出す**ので、出所(AI 要約であること)と
    /// 「助言ではない」断りを必ず本文に含める。アプリ内では画面の
    /// 注意書きが担っている役割が、共有先には付いてこないため。
    static func shareText(
        ticker: String,
        companyName: String,
        question: String,
        conclusion: String
    ) -> String {
        let ticker = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let companyName = companyName.trimmingCharacters(in: .whitespacesAndNewlines)
        let question = collapsedWhitespace(question)
        let conclusion = truncated(collapsedWhitespace(conclusion), limit: sharedConclusionLimit)

        let subject: String
        if companyName.isEmpty {
            subject = ticker
        } else if ticker.isEmpty {
            subject = companyName
        } else {
            subject = "\(ticker) \(companyName)"
        }

        var lines: [String] = []
        if !subject.isEmpty {
            lines.append("\(subject) の決算資料を Kabuyomi で読みました。")
            lines.append("")
        }
        if !question.isEmpty {
            lines.append("Q. \(question)")
        }
        if !conclusion.isEmpty {
            lines.append("A. \(conclusion)")
        }
        if !question.isEmpty || !conclusion.isEmpty {
            lines.append("")
        }
        lines.append("※ 米国 SEC 提出書類にもとづく AI 要約です。投資助言ではありません。")
        lines.append(shareURL.absoluteString)
        return lines.joined(separator: "\n")
    }

    private static func collapsedWhitespace(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private static func truncated(_ text: String, limit: Int) -> String {
        guard text.count > limit else { return text }
        return String(text.prefix(limit)) + "…"
    }
}

/// レビュー依頼を出してよいかどうかだけを判定する。
///
/// Apple 側でも年3回に絞られるが、**出し方**はアプリの責任で、
/// 起動直後や失敗直後に出すと低い評価をわざわざ集めることになる。
/// ここでは「回答が成功して読み終わったあと」という成功体験の直後だけに絞り、
/// さらに1バージョンにつき1回までに制限する。
struct ReviewPromptGate {
    static let successfulAnswerCountKey = "kabuyomi.review.successfulAnswerCount"
    static let lastPromptedVersionKey = "kabuyomi.review.lastPromptedVersion"

    /// 1回目の回答で聞くのは早すぎる(まだ良し悪しが分かっていない)。
    /// 3回目 = 少なくとも一度は「また使った」人だけに聞く。
    static let successfulAnswerThreshold = 3

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var successfulAnswerCount: Int {
        defaults.integer(forKey: Self.successfulAnswerCountKey)
    }

    /// 回答が1件成功したことを記録し、**いま依頼を出すべきか**を返す。
    /// `true` を返したときだけ、依頼済みバージョンを書き込む。
    func recordSuccessfulAnswer(appVersion: String) -> Bool {
        let count = successfulAnswerCount + 1
        defaults.set(count, forKey: Self.successfulAnswerCountKey)

        guard count >= Self.successfulAnswerThreshold else { return false }
        guard !appVersion.isEmpty else { return false }
        guard defaults.string(forKey: Self.lastPromptedVersionKey) != appVersion else { return false }

        defaults.set(appVersion, forKey: Self.lastPromptedVersionKey)
        return true
    }

    static func currentAppVersion(bundle: Bundle = .main) -> String {
        (bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
    }
}
