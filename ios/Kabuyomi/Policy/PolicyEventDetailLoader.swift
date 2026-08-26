import SwiftUI

// MarketDocket では `AppRootView.swift`(2つ目の App 本体)の中にいた。
// 詳細画面へ渡す前の読み込みと翻訳依頼だけを持つ部品なので、本体は置いてきて
// これだけ切り出した(2026-08-26 の移植)。

struct EventDetailLoader: View {
    let summary: PolicyEventSummary
    @EnvironmentObject private var eventStore: EventDataStore
    @State private var event: PolicyEvent?
    @State private var origin: RepositoryOrigin?
    @State private var errorMessage: String?
    @State private var translationStatus: TranslationRequestStatus?
    @State private var translationIsSubmitting = false
    @State private var translationErrorMessage: String?

    var body: some View {
        Group {
            if let event {
                VStack(spacing: 0) {
                    if origin == .offlineCache { DataSourceNotice(text: "オフライン・前回取得データ", systemImage: "wifi.slash") }
                    if event.isSynthetic { DataSourceNotice(text: "デモデータ・合成値", systemImage: "testtube.2") }
                    EventDetailView(
                        event: event,
                        translationStatus: translationStatus,
                        translationIsSubmitting: translationIsSubmitting,
                        translationErrorMessage: translationErrorMessage,
                        requestTranslation: { Task { await requestTranslation() } },
                        refresh: { await refresh() }
                    )
                }
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("イベントを読み込めません", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("再試行") { Task { await load() } }
                }
            } else {
                ProgressView("イベントを取得中")
            }
        }
        .task(id: summary.lastActivityAt) { await load() }
        .task(id: translationStatus?.shouldPoll == true) {
            guard translationStatus?.shouldPoll == true else { return }
            await pollTranslation()
        }
    }

    private func load() async {
        errorMessage = nil
        do {
            let result = try await eventStore.loadEvent(summary)
            event = result.value
            origin = result.origin
            if result.value.isSynthetic || result.origin == .offlineCache {
                translationStatus = nil
            } else {
                translationStatus = try? await eventStore.translationStatus(for: summary.id)
            }
        } catch {
            errorMessage = "最新データを取得できませんでした。時間をおいて再度お試しください。"
        }
    }

    private func requestTranslation() async {
        guard !translationIsSubmitting else { return }
        translationIsSubmitting = true
        translationErrorMessage = nil
        defer { translationIsSubmitting = false }
        do {
            let latest = try await eventStore.requestTranslation(for: summary.id)
            translationStatus = latest
            if latest.state == .translated {
                await refresh()
            }
        } catch {
            translationErrorMessage = "翻訳を受け付けられませんでした。通信状態を確認して再度お試しください。"
        }
    }

    private func refresh() async {
        translationErrorMessage = nil
        await load()
        await eventStore.refreshSummaries()
    }

    private func pollTranslation() async {
        var attempt = 0
        while !Task.isCancelled, translationStatus?.shouldPoll == true {
            let seconds = translationStatus?.pollDelaySeconds(attempt: attempt) ?? 2
            do { try await Task.sleep(for: .seconds(seconds)) }
            catch { return }
            guard !Task.isCancelled else { return }
            do {
                let latest = try await eventStore.translationStatus(for: summary.id)
                if latest?.state == .translated {
                    let refreshed = try await eventStore.loadEvent(summary)
                    event = refreshed.value
                    origin = refreshed.origin
                    translationStatus = latest
                    await eventStore.refreshSummaries()
                    return
                }
                translationStatus = latest
                attempt += 1
            } catch {
                return
            }
        }
    }
}

struct DataSourceNotice: View {
    let text, systemImage: String
    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(KabuyomiTheme.inkMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(KabuyomiTheme.inkMuted.opacity(0.08))
    }
}
