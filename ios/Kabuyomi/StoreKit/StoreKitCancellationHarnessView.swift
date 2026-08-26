#if DEBUG
import SwiftUI

/// A Debug-only surface that lets XCUITest exercise the actual StoreKit
/// purchase sheet without calling Kabuyomi's backend or granting credits.
struct StoreKitCancellationHarnessView: View {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains("-StoreKitCancellationHarness")
    }

    @State private var store: SubscriptionStore
    @State private var status = "ready"

    init() {
        let suiteName = "StoreKitCancellationHarness"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        _store = State(initialValue: SubscriptionStore(defaults: defaults))
    }

    var body: some View {
        VStack(spacing: 24) {
            Text("StoreKit Cancellation Test")
                .font(.title2.bold())

            Text(status)
                .accessibilityIdentifier("storekit.harness.status")

            Button("Start subscription purchase") {
                status = "purchasing"
                Task {
                    do {
                        let purchase = try await store.purchaseSubscription(
                            productId: "kabuyomi.sub.pro.monthly"
                        )
                        if let purchase {
                            await purchase.finish()
                            status = "succeeded"
                        } else {
                            status = "cancelled"
                        }
                    } catch {
                        status = "error: \(error.localizedDescription)"
                    }
                }
            }
            // AccentColor が v2 の teal になったので、`.borderedProminent` の既定の
            // 白文字はダークで teal 上に載って読めない(1.7:1)。本番の prominent
            // ボタンと同じく塗りは accent、文字は onAccent に固定する。
            .buttonStyle(.borderedProminent)
            .tint(KabuyomiTheme.accent)
            .foregroundStyle(KabuyomiTheme.onAccent)
            .accessibilityIdentifier("storekit.harness.purchase")
        }
        .padding(32)
    }
}
#endif
