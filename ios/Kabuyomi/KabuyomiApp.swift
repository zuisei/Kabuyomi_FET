import SwiftUI

@main
struct KabuyomiApp: App {
    @State private var appModel = AppModel.live()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(appModel)
                .environment(\.managedObjectContext, appModel.persistence.viewContext)
                .preferredColorScheme(.light)
        }
    }
}
