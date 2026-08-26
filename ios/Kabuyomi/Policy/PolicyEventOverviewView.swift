import SwiftUI

struct EventOverviewView: View {
    let event: PolicyEvent
    let translationStatus: TranslationRequestStatus?
    let translationIsSubmitting: Bool
    let translationErrorMessage: String?
    let requestTranslation: (() -> Void)?
    let refresh: (() async -> Void)?
    let goToReplay: () -> Void
    let goToEvidence: () -> Void

    var body: some View {
        PolicyOverviewContent(
            event: event,
            translationStatus: translationStatus,
            translationIsSubmitting: translationIsSubmitting,
            translationErrorMessage: translationErrorMessage,
            requestTranslation: requestTranslation,
            refresh: refresh,
            goToReplay: goToReplay,
            goToEvidence: goToEvidence
        )
            .accessibilityIdentifier("eventDetail.overview")
    }
}
