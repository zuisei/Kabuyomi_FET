import Foundation

// v2 IA Phase 4(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 4」節)の導出ロジック。
//
// タブは消え、根の面は1本のストリームになった。ストリームに流れるのは
// 「自分が聞いた質問と回答」と「追っている会社に資料が出たという事実」の2種類だけで、
// どちらも Phase 3 の導出(researchArchiveGroups / homeFeedRows)を土台にする。
//
// HomeBoardSupport.swift と同じ約束: ここには view も AppModel も持ち込まない。
// 入力はすべて値、出力も値。並び順・提案質問・文脈の既定値・
// 「チップは入力欄に載せるだけで送らない」という契約を、
// 画面を起動せずに単体テストで固定できる状態に保つ。

// MARK: - 質問の宛先(アスクバーの会社チップ)

/// アスクバーが今どの会社に向いているか。
struct StreamAskContext: Equatable, Hashable {
    let ticker: String
    let companyName: String

    /// 社名が取れていない会社ではチップに ticker を出す。
    /// 「AAPL / AAPL」と2つ並べない(Phase 3 の板行と同じ判断)。
    var displayName: String {
        companyName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? ticker : companyName
    }
}

/// 会社チップの既定値。最後に開いた会社 → 直近の保存済み → なし。
///
/// 「なし」を許すのが要点。まだ1社も触っていない人にスターター企業を
/// 勝手に宛先として据えると、本人が選んでいない会社へクレジットを使うことになる。
/// 宛先が無いときは送信できない状態のまま、会社を選ばせる。
func streamAskContext(
    lastOpenedTicker: String?,
    saved: [WatchlistCard],
    recent: [WatchlistCard]
) -> StreamAskContext? {
    let known = saved + recent

    if let lastOpenedTicker {
        let normalized = lastOpenedTicker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if !normalized.isEmpty {
            let name = known.first { $0.ticker.uppercased() == normalized }?.companyName ?? ""
            return StreamAskContext(
                ticker: normalized,
                companyName: homeBoardCompanyName(companyName: name, ticker: normalized)
            )
        }
    }

    if let newestSaved = saved.first {
        let ticker = newestSaved.ticker.uppercased()
        return StreamAskContext(
            ticker: ticker,
            companyName: homeBoardCompanyName(companyName: newestSaved.companyName, ticker: ticker)
        )
    }

    return nil
}

// MARK: - 残高表示

/// アスクバーの残高。常時出しっぱなしなので、単位も内訳も落として数だけを出す。
/// (会社ワークスペースのコンポーザは `chatCreditStatusText` の
/// 「2クレジット / 残り N」を出し続ける。あちらは開いたときだけ現れる面なので、
/// 消費コストまで見せる余裕がある。)
func streamCreditBalanceText(totalRemaining: Int?) -> String {
    guard let totalRemaining else { return "残高を確認" }
    return "残り \(totalRemaining)"
}

// MARK: - 提案質問

/// 資料が出たカードに添える提案質問。
///
/// 文言は会社ワークスペースの `buildSuggestedQuestions` が出すものと同じものだけを使う。
/// ストリームのカードが持っているのは `WatchlistCard`(= 指標と form だけ)で
/// `CompanyPayload` ではないため関数そのものは呼べないが、
/// 選ぶ順序と文字列は揃える。`StreamSupportTests` が
/// 「ストリームの提案は必ずワークスペースの提案の部分集合」を固定している。
func streamSuggestedQuestions(
    formType: String,
    metrics: [MetricPayload],
    limit: Int = 3
) -> [String] {
    var suggestions = ["今回の最大変化は？"]

    if let revenue = metrics.first(where: { $0.logicalName == "revenue" }),
       let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "売上を伸ばした要因は？" : "売上が弱かった要因は？")
    }

    if let operatingIncome = metrics.first(where: { $0.logicalName == "operatingIncome" }),
       let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率は改善？" : "利益率が悪化した理由は？")
    }

    // 指標がキャッシュに無い会社でもチップが1枚では選びようがない。
    // ワークスペース側が件数を満たせないときに足すのと同じ「前回との差」を足す。
    suggestions.append(formType == "10-Q" ? "前回四半期との差は？" : "前回決算との違いは？")

    var seen = Set<String>()
    let deduplicated = suggestions.filter { seen.insert($0).inserted }
    return limit > 0 ? Array(deduplicated.prefix(limit)) : deduplicated
}

// MARK: - 資料が出たカード

/// 「{会社} の {form} が出ました」のカード。
struct StreamFilingEventCard: Identifiable, Equatable {
    let ticker: String
    let companyName: String
    let formType: String
    let filedAt: Date
    let filingKey: String
    /// 要約 verdict の書き出し1文(Phase 3 の新着行と同じもの)。
    let verdictLine: String
    /// Phase 3 の未読状態。会社を開けば `markCompanyOpened` で消える。
    let isUnread: Bool
    /// 会社ヘッダー行に添える売上 YoY(Phase 5)。売上がキャッシュに無ければ nil。
    /// サマリーの板行は3本並べるが、ストリームのカードは1枚が読み面なので1本に絞る。
    let revenueDelta: MetricYoYDisplay?
    let suggestedQuestions: [String]

    var id: String { filingKey.isEmpty ? ticker : filingKey }

    /// 見出し。社名が取れていない会社では ticker を主語にする。
    var headline: String {
        let name = homeBoardCompanyName(companyName: companyName, ticker: ticker)
        let subject = name.isEmpty ? ticker : name
        return "\(subject) の \(formType) が出ました"
    }
}

/// 資料イベントの並び。Phase 3 の `homeFeedRows` をそのまま土台にし、
/// 未読と提案質問を足す。順序・重複排除・placeholder の除外は Phase 3 の判断を引き継ぐ。
func streamFilingEvents(
    saved: [WatchlistCard],
    recent: [WatchlistCard],
    lastOpenedAt: [String: Date],
    limit: Int = 12
) -> [StreamFilingEventCard] {
    var cardsByTicker: [String: WatchlistCard] = [:]
    for card in saved + recent where cardsByTicker[card.ticker] == nil {
        cardsByTicker[card.ticker] = card
    }

    return homeFeedRows(saved: saved, recent: recent, limit: limit).map { row in
        let card = cardsByTicker[row.ticker]
        return StreamFilingEventCard(
            ticker: row.ticker,
            companyName: row.companyName,
            formType: row.formType,
            filedAt: row.filedAt,
            filingKey: row.filingKey,
            verdictLine: row.verdictLine,
            isUnread: homeBoardIsUnread(
                filedAt: row.filedAt,
                isPlaceholder: card?.isPlaceholder ?? false,
                lastOpenedAt: lastOpenedAt[row.ticker]
            ),
            revenueDelta: homeBoardDelta(metrics: card?.metrics ?? []),
            suggestedQuestions: streamSuggestedQuestions(
                formType: row.formType,
                metrics: card?.metrics ?? []
            )
        )
    }
}

// MARK: - ストリーム(質問と資料を1本に混ぜる)

/// ストリームの1枚。
enum StreamItem: Identifiable, Equatable {
    /// 過去の質問と回答。Phase 3 のアーカイブ項目をそのまま持つ。
    case answer(ResearchArchiveEntry)
    /// 追っている会社に資料が出たという事実。
    case filingEvent(StreamFilingEventCard)

    var id: String {
        switch self {
        case .answer(let entry):
            return "answer:\(entry.id)"
        case .filingEvent(let event):
            return "filing:\(event.id)"
        }
    }

    /// 並びの基準。
    /// 回答は「回答が届いた時刻」(まだ回答が無ければ質問した時刻)、
    /// 資料は提出日。質問した時刻ではなく届いた時刻を使うのは、
    /// カードが今の姿になった瞬間がそこだから。
    var timestamp: Date {
        switch self {
        case .answer(let entry):
            return entry.latestActivity
        case .filingEvent(let event):
            return event.filedAt
        }
    }

    /// 同時刻の決定論的な並び。自分の操作(質問)を、受け身の出来事(提出)より先に置く。
    var kindRank: Int {
        switch self {
        case .answer:
            return 0
        case .filingEvent:
            return 1
        }
    }
}

/// ストリーム本体。新しい順に、質問と資料を1本へ混ぜる。
///
/// `answerLimit` は**回答だけ**に効かせる。混ぜたあとの合計に上限をかけると、
/// 質問を大量に持っている人ほど資料イベントが窓の外へ押し出され、
/// 「資料が出た」という合図がいちばん使っている人に届かなくなる。
func streamItems(
    archiveGroups: [ResearchArchiveGroup],
    filingEvents: [StreamFilingEventCard],
    answerLimit: Int = 40
) -> [StreamItem] {
    let answers = archiveGroups
        .flatMap(\.entries)
        .sorted { lhs, rhs in
            lhs.latestActivity == rhs.latestActivity
                ? lhs.id < rhs.id
                : lhs.latestActivity > rhs.latestActivity
        }

    let cappedAnswers = answerLimit > 0 ? Array(answers.prefix(answerLimit)) : answers

    var items: [StreamItem] = cappedAnswers.map(StreamItem.answer)
    items.append(contentsOf: filingEvents.map(StreamItem.filingEvent))

    items.sort { lhs, rhs in
        if lhs.timestamp != rhs.timestamp { return lhs.timestamp > rhs.timestamp }
        if lhs.kindRank != rhs.kindRank { return lhs.kindRank < rhs.kindRank }
        return lhs.id < rhs.id
    }

    return items
}

// MARK: - 質問を送る唯一の道

/// コンポーザが使えない理由。会社ワークスペースの底のコンポーザと
/// ストリームのアスクバーが**同じ関数**からこの文字列を得る。
///
/// 文字列と優先順位はどちらの面でも同一。
/// 呼び出し側が `"残高不足"` で分岐しているので(クレジットを確認ボタンの出し分け)、
/// 文言も順序もここ以外では決めない。
///
/// 「会社が選ばれていない」はここに入れない。ワークスペースには必ず会社があり、
/// 宛先が無いのはアスクバーだけの状態。混ぜるとワークスペース側の意味が変わる。
func redesignComposerDisabledReason(
    isSending: Bool,
    hasChatCreditAvailable: Bool,
    authenticatedCreditActionsAvailable: Bool,
    chatEnabled: Bool?
) -> String? {
    if isSending { return "回答を作成中です" }
    if !hasChatCreditAvailable { return "残高不足" }
    if !authenticatedCreditActionsAvailable { return "端末認証を確認中" }
    if chatEnabled == false { return "質問機能を一時停止中" }
    return nil
}

/// 送信ボタンを押したときに何が起きるべきか。
enum RedesignAskPreparation: Equatable {
    /// 空文字。何も起きない。
    case empty
    /// コンポーザが使えない。理由は `redesignComposerDisabledReason` の文字列。
    case blocked(reason: String)
    /// AI 利用への同意がまだ。同意を求めてから送る。
    case needsConsent(question: String)
    /// そのまま送れる。
    case ready(question: String)
}

/// 送信前の判定。2つのコンポーザが同じ順序で同じ結論に至るための1か所。
func redesignAskPreparation(
    rawQuestion: String,
    disabledReason: String?,
    aiConsentGranted: Bool
) -> RedesignAskPreparation {
    let trimmed = rawQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .empty }
    if let disabledReason { return .blocked(reason: disabledReason) }
    guard aiConsentGranted else { return .needsConsent(question: trimmed) }
    return .ready(question: trimmed)
}

// MARK: - アスクバーに起きうること

/// アスクバーへの働きかけ。**入力欄に載せる**のと**送る**を型で分ける。
enum StreamAskBarIntent: Equatable {
    /// 入力欄に載せるだけ。クレジットは1つも減らない。
    case prefill(question: String, context: StreamAskContext?)
    /// 送る。人が送信ボタンを押したときだけ生まれる。
    case submit(question: String, context: StreamAskContext)
}

/// 提案質問チップ / 例示チップを押したとき。**常に `.prefill`**。
///
/// 7月ルール「ライフサイクルのコールバックからは質問を送らない」を、
/// Phase 4 ではチップにも広げる。質問1件はクレジットを消費するので、
/// 送信は「送信ボタンを押した」以外のどの操作からも生まれてはならない。
/// この関数は `.submit` を返す道を持たない。
func streamSuggestedQuestionIntent(
    question: String,
    context: StreamAskContext?
) -> StreamAskBarIntent? {
    let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return .prefill(question: trimmed, context: context)
}

/// 送信ボタンを押したとき。宛先が決まっていて、コンポーザが使えるときだけ `.submit`。
/// 宛先が無いときに `.prefill` へ落とさないのは、
/// すでに入力欄に載っている文字をもう一度載せ直しても何も起きないから。
func streamSendIntent(
    draft: String,
    context: StreamAskContext?,
    disabledReason: String?
) -> StreamAskBarIntent? {
    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, disabledReason == nil, let context else { return nil }
    return .submit(question: trimmed, context: context)
}

// MARK: - 空のストリーム

/// まだ何も無い人に出す例示の質問。会話体のまま置く。
/// (Phase 4 の新規画面の新規文言。既存文言は据え置き。)
let streamExampleQuestions: [String] = [
    "この会社ってなにで稼いでんの？",
    "前より儲かってる？",
    "今回いちばん変わったのはどこ？"
]
