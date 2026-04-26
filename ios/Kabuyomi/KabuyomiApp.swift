import SwiftUI
import GoogleMobileAds

@main
struct KabuyomiApp: App {
    @State private var appModel = AppModel.live()

    init() {
        MobileAds.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(appModel)
                .environment(\.managedObjectContext, appModel.persistence.viewContext)
                .preferredColorScheme(.light)
        }
    }
}
