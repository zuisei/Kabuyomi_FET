import SwiftUI

struct EventReplayView: View {
    let event: PolicyEvent
    let requestedMilestone: ReplayMilestone?

    init(event: PolicyEvent, requestedMilestone: ReplayMilestone? = nil) {
        self.event = event
        self.requestedMilestone = requestedMilestone
    }

    var body: some View {
        PolicyReplayContent(event: event, requestedMilestone: requestedMilestone)
            .accessibilityIdentifier("eventDetail.replay")
    }
}
