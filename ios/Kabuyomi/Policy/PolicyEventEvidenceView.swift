import SwiftUI

enum EvidenceLanguage: String, CaseIterable, Identifiable {
    case japanese = "日本語要点"
    case original = "原文"

    var id: Self { self }
}

struct EventEvidenceView: View {
    let event: PolicyEvent

    var body: some View {
        PolicyEvidenceContent(event: event)
            .accessibilityIdentifier("eventDetail.evidence")
    }
}
