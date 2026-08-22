import Foundation

// MARK: - 1行に詰めるための書き出し

/// 板行・新着行・アーカイブ行の2行目に使う「書き出し1文」。
///
/// `leadSentence` は ASCII のピリオドを無条件に文末として扱うので、
/// 「売上高は前年同期比で約16.6%増、…」が「売上高は前年同期比で約16.」で切れる
/// (シミュレータ実機確認 2026-08-22 で実際に出た)。
/// 小数点で切らないよう、ASCII のピリオドは後ろが空白か終端のときだけ文末とみなす。
/// `leadSentence` 自体は Phase 1/2 の別の画面が依存しているので、ここで閉じる。
func redesignLeadSentence(_ text: String) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let characters = Array(trimmed)
    for (index, character) in characters.enumerated() {
        let isJapaneseTerminator = character == "。" || character == "！" || character == "？"
        let isASCIITerminator: Bool = {
            guard character == "." || character == "!" || character == "?" else { return false }
            guard index + 1 < characters.count else { return true }
            let next = characters[index + 1]
            return next == " " || next == "\n" || next == "\t"
        }()
        guard isJapaneseTerminator || isASCIITerminator else { continue }
        let sentence = String(characters[...index]).trimmingCharacters(in: .whitespacesAndNewlines)
        return sentence.isEmpty ? nil : sentence
    }

    return trimmed
}

// v2 IA(docs/ui-redesign-v2/V2_IA_SPEC.md)のホーム/研究タブの導出ロジック。
//
// ここには view も AppModel も持ち込まない。入力はすべて値(WatchlistCard /
// LocalCompanyRecord / 最終閲覧時刻の辞書)で受け取り、出力も値で返す。
// CompanySourceSupport と同じく、画面を起動しなくても順序・書式・未読判定を
// 単体テストで固定できる状態を保つための分離。

// MARK: - 盤面(ウォッチリスト)

/// 盤面の1行。ticker / 社名 / 最新 filing / デルタピル / 未読ドット。
struct HomeBoardRow: Identifiable, Equatable {
    let ticker: String
    let companyName: String
    let formType: String
    let filedAt: Date
    /// 保存直後などで、まだ filing を1件も取得できていない行。
    let isPlaceholder: Bool
    let isSaved: Bool
    let isUnread: Bool
    /// 売上 YoY のピル。売上指標がキャッシュに無い会社では nil。
    let delta: MetricYoYDisplay?

    var id: String { ticker }
}

/// 盤面の並び。保存済みを先に、その下に「最近開いた」を渡された順のまま置く。
/// 両方に出てくる会社は保存側の位置に1回だけ出す(保存済みであることを優先する)。
func homeBoardRows(
    saved: [WatchlistCard],
    recent: [WatchlistCard],
    lastOpenedAt: [String: Date]
) -> [HomeBoardRow] {
    var seen = Set<String>()
    var rows: [HomeBoardRow] = []

    for card in saved where seen.insert(card.ticker).inserted {
        rows.append(homeBoardRow(card: card, isSaved: true, lastOpenedAt: lastOpenedAt))
    }
    for card in recent where seen.insert(card.ticker).inserted {
        rows.append(homeBoardRow(card: card, isSaved: false, lastOpenedAt: lastOpenedAt))
    }

    return rows
}

private func homeBoardRow(
    card: WatchlistCard,
    isSaved: Bool,
    lastOpenedAt: [String: Date]
) -> HomeBoardRow {
    HomeBoardRow(
        ticker: card.ticker,
        companyName: homeBoardCompanyName(companyName: card.companyName, ticker: card.ticker),
        formType: card.formType,
        filedAt: card.filedAt,
        isPlaceholder: card.isPlaceholder,
        isSaved: isSaved,
        isUnread: homeBoardIsUnread(
            filedAt: card.filedAt,
            isPlaceholder: card.isPlaceholder,
            lastOpenedAt: lastOpenedAt[card.ticker]
        ),
        delta: homeBoardDelta(metrics: card.metrics)
    )
}

/// 板行の社名。まだ会社名を取得できていない行のカードは社名に ticker が入るので、
/// そのまま出すと「AAPL / AAPL」と2段同じ文字が並ぶ(シミュレータ実機確認 2026-08-22)。
/// 名乗るものが無いときは空にして、行側で2行目を落とす。
func homeBoardCompanyName(companyName: String, ticker: String) -> String {
    let trimmed = companyName.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.caseInsensitiveCompare(ticker) == .orderedSame ? "" : trimmed
}

/// デルタピルは売上 YoY だけを出す(v2 IA 仕様)。
/// 売上が取れていない会社で別の指標に差し替えると、
/// 行ごとに違う指標のピルが並んで板として読めなくなる。
func homeBoardDelta(metrics: [MetricPayload]) -> MetricYoYDisplay? {
    guard let revenue = metrics.first(where: { $0.logicalName == "revenue" }) else { return nil }
    return metricYoYDisplay(for: revenue)
}

/// 未読ドット。キャッシュ済み filing の提出日が「その会社を最後に開いた時刻」より新しければ未読。
///
/// 最終閲覧時刻が無い会社は**既読**として扱う。
/// この状態はこのフェーズで新設したもので、アップデート前から保存されている会社には
/// 当然1件も記録が無い。「記録が無い=未読」にすると、更新直後の初回起動で
/// 盤面が丸ごとドットで埋まり、未読という合図そのものが意味を失う。
func homeBoardIsUnread(filedAt: Date, isPlaceholder: Bool, lastOpenedAt: Date?) -> Bool {
    guard !isPlaceholder, let lastOpenedAt else { return false }
    return filedAt > lastOpenedAt
}

// MARK: - 新着(フィード)

/// 新着の1行。会社 + form + 提出日 + 要約 verdict の1行。
struct HomeFeedRow: Identifiable, Equatable {
    let ticker: String
    let companyName: String
    let formType: String
    let filedAt: Date
    let filingKey: String
    /// 要約の verdict の書き出し1文。verdict が無ければ社名で代替する。
    let verdictLine: String
    let isUnread: Bool

    var id: String { filingKey.isEmpty ? ticker : filingKey }
}

/// 新着の並び。トラック中(保存済み+最近開いた)の会社のキャッシュ済み filing を
/// 提出日の降順に並べる。
///
/// ローカルキャッシュが会社ごとに保持している「カード」は最新 filing 1件なので、
/// 新着も会社ごとに1行になる。過去 filing まで時系列に流すには
/// PersistenceController に新しい問い合わせが要り、
/// 「既存の AppModel の状態から導出する」という制約を外れるため、ここでは取らない。
func homeFeedRows(
    saved: [WatchlistCard],
    recent: [WatchlistCard],
    lastOpenedAt: [String: Date],
    limit: Int = 12
) -> [HomeFeedRow] {
    var seen = Set<String>()
    var rows: [HomeFeedRow] = []

    for card in saved + recent {
        guard seen.insert(card.ticker).inserted else { continue }
        // まだ filing を取れていない会社は「新着」ではない。
        // filedAt が .distantPast なので、混ぜると並びの底に溜まるだけになる。
        guard !card.isPlaceholder, !card.formType.isEmpty else { continue }
        rows.append(
            HomeFeedRow(
                ticker: card.ticker,
                companyName: card.companyName,
                formType: card.formType,
                filedAt: card.filedAt,
                filingKey: card.filingKey,
                verdictLine: homeFeedVerdictLine(verdict: card.verdict, companyName: card.companyName),
                isUnread: homeBoardIsUnread(
                    filedAt: card.filedAt,
                    isPlaceholder: card.isPlaceholder,
                    lastOpenedAt: lastOpenedAt[card.ticker]
                )
            )
        )
    }

    // 同じ日に提出された会社が並ぶので、日付だけでは順序が決まらない。
    // ticker の昇順で決定論的に固定する。
    rows.sort { lhs, rhs in
        lhs.filedAt == rhs.filedAt ? lhs.ticker < rhs.ticker : lhs.filedAt > rhs.filedAt
    }

    return limit > 0 ? Array(rows.prefix(limit)) : rows
}

/// 新着行の2行目。verdict の書き出し1文だけを使う。
/// verdict が空(要約がまだ無い / 取得に失敗した)ときは社名を置く。
func homeFeedVerdictLine(verdict: String, companyName: String) -> String {
    guard let lead = redesignLeadSentence(verdict) else { return companyName }
    return lead
}

// MARK: - 研究(Q&A アーカイブ)

/// アーカイブの1件 = 過去の質問1つと、それに続く回答。
struct ResearchArchiveEntry: Identifiable, Equatable {
    let id: String
    let filingKey: String
    let formType: String
    /// 提出日は生の文字列のまま持ち、書式は表示側に任せる
    /// (ロケール依存の整形を純ロジックへ持ち込まない)。
    let filedAt: String
    let question: String
    /// 回答の書き出し1文。まだ回答が無い質問では nil。
    let answerPreview: String?
    let answerCount: Int
    let askedAt: Date
    let latestActivity: Date
}

/// 会社ごとのグループ。会社行 → 会社ワークスペース、質問行 → その会話。
struct ResearchArchiveGroup: Identifiable, Equatable {
    let ticker: String
    let companyName: String
    let latestActivity: Date
    let entries: [ResearchArchiveEntry]

    var id: String { ticker }

    var questionCount: Int { entries.count }
}

/// 過去の Q&A を会社別にまとめ、会社もその中の質問も新しい順に並べる。
/// 質問が1件も無い会話(要約だけ開いて終わった filing)はアーカイブに出さない。
func researchArchiveGroups(records: [LocalCompanyRecord]) -> [ResearchArchiveGroup] {
    var entriesByTicker: [String: [ResearchArchiveEntry]] = [:]
    var nameByTicker: [String: String] = [:]

    for record in records {
        let ticker = record.company.ticker
        let entries = researchArchiveEntries(for: record)
        guard !entries.isEmpty else { continue }
        entriesByTicker[ticker, default: []].append(contentsOf: entries)
        if nameByTicker[ticker] == nil {
            nameByTicker[ticker] = record.company.companyName
        }
    }

    return entriesByTicker.map { ticker, entries in
        let sorted = entries.sorted { lhs, rhs in
            lhs.askedAt == rhs.askedAt ? lhs.id < rhs.id : lhs.askedAt > rhs.askedAt
        }
        return ResearchArchiveGroup(
            ticker: ticker,
            companyName: nameByTicker[ticker] ?? ticker,
            latestActivity: sorted.map(\.latestActivity).max() ?? .distantPast,
            entries: sorted
        )
    }
    .sorted { lhs, rhs in
        lhs.latestActivity == rhs.latestActivity
            ? lhs.ticker < rhs.ticker
            : lhs.latestActivity > rhs.latestActivity
    }
}

private func researchArchiveEntries(for record: LocalCompanyRecord) -> [ResearchArchiveEntry] {
    let messages = record.chatHistory
    var entries: [ResearchArchiveEntry] = []

    for (index, message) in messages.enumerated() where message.role == "user" {
        let question = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { continue }

        // 次の質問までの範囲が、この質問への回答。
        var answers: [LocalChatMessage] = []
        var cursor = index + 1
        while cursor < messages.count, messages[cursor].role != "user" {
            if messages[cursor].role == "assistant" {
                answers.append(messages[cursor])
            }
            cursor += 1
        }

        entries.append(
            ResearchArchiveEntry(
                id: message.id.uuidString,
                filingKey: record.company.filingKey,
                formType: record.company.formType,
                filedAt: record.company.filedAt,
                question: question,
                answerPreview: answers.first.flatMap { answer in
                    redesignLeadSentence(localizedAssistantDisplayText(answer.content))
                },
                answerCount: answers.count,
                askedAt: message.createdAt,
                latestActivity: answers.last?.createdAt ?? message.createdAt
            )
        )
    }

    return entries
}
