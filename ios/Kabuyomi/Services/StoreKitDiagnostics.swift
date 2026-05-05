import Foundation

enum StoreKitProductLoadStatus: String, Equatable {
    case notStarted = "not_started"
    case started
    case success
    case empty
    case failed
}

struct StoreKitDiagnosticsError: Equatable {
    let type: String
    let domain: String
    let code: Int
    let message: String

    init(error: Error) {
        let nsError = error as NSError
        self.type = String(describing: Swift.type(of: error))
        self.domain = nsError.domain
        self.code = nsError.code
        self.message = nsError.localizedDescription
    }
}

struct StoreKitDiagnosticsSnapshot: Equatable {
    var appVersion: String
    var buildNumber: String
    var bundleIdentifier: String
    var buildConfiguration: String
    var runtimeMode: String
    var requestedProductIds: [String]
    var returnedProductCount: Int
    var returnedProductIds: [String]
    var canMakePayments: Bool?
    var storefrontCountryCode: String?
    var storefrontId: String?
    var productLoadStatus: StoreKitProductLoadStatus
    var productLoadStartedAt: String?
    var productLoadCompletedAt: String?
    var lastProductLoadError: StoreKitDiagnosticsError?
    var localStoreKitConfigurationStatus: String
    var purchaseButtonVisibilityReason: String
    var latestPurchaseStatus: String
    var latestPurchaseError: StoreKitDiagnosticsError?
    var backendGrantStatus: String
    var backendGrantError: StoreKitDiagnosticsError?

    static func initial(
        appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
        buildNumber: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
        bundleIdentifier: String = Bundle.main.bundleIdentifier ?? "unknown",
        requestedProductIds: [String] = []
    ) -> StoreKitDiagnosticsSnapshot {
        StoreKitDiagnosticsSnapshot(
            appVersion: appVersion,
            buildNumber: buildNumber,
            bundleIdentifier: bundleIdentifier,
            buildConfiguration: StoreKitDiagnosticsSnapshot.currentBuildConfiguration,
            runtimeMode: StoreKitDiagnosticsSnapshot.currentRuntimeMode,
            requestedProductIds: requestedProductIds,
            returnedProductCount: 0,
            returnedProductIds: [],
            canMakePayments: nil,
            storefrontCountryCode: nil,
            storefrontId: nil,
            productLoadStatus: .notStarted,
            productLoadStartedAt: nil,
            productLoadCompletedAt: nil,
            lastProductLoadError: nil,
            localStoreKitConfigurationStatus: StoreKitDiagnosticsSnapshot.localStoreKitConfigurationStatus(),
            purchaseButtonVisibilityReason: "not_evaluated",
            latestPurchaseStatus: "not_started",
            latestPurchaseError: nil,
            backendGrantStatus: "not_started",
            backendGrantError: nil
        )
    }

    var diagnosticLines: [String] {
        var lines = [
            "appVersion: \(appVersion)",
            "buildNumber: \(buildNumber)",
            "bundleIdentifier: \(bundleIdentifier)",
            "buildConfiguration: \(buildConfiguration)",
            "runtimeMode: \(runtimeMode)",
            "requestedProductIds: \(requestedProductIds.joined(separator: ","))",
            "returnedProductCount: \(returnedProductCount)",
            "returnedProductIds: \(returnedProductIds.joined(separator: ","))",
            "canMakePayments: \(canMakePayments.map(String.init) ?? "unknown")",
            "storefrontCountryCode: \(storefrontCountryCode ?? "unknown")",
            "storefrontId: \(storefrontId ?? "unknown")",
            "productLoadStatus: \(productLoadStatus.rawValue)",
            "productLoadStartedAt: \(productLoadStartedAt ?? "none")",
            "productLoadCompletedAt: \(productLoadCompletedAt ?? "none")",
            "localStoreKitConfiguration: \(localStoreKitConfigurationStatus)",
            "purchaseButtonVisibilityReason: \(purchaseButtonVisibilityReason)",
            "latestPurchaseStatus: \(latestPurchaseStatus)",
            "backendGrantStatus: \(backendGrantStatus)"
        ]

        if let lastProductLoadError {
            lines.append("lastProductLoadError: \(lastProductLoadError.summary)")
        } else {
            lines.append("lastProductLoadError: none")
        }

        if let latestPurchaseError {
            lines.append("latestPurchaseError: \(latestPurchaseError.summary)")
        } else {
            lines.append("latestPurchaseError: none")
        }

        if let backendGrantError {
            lines.append("backendGrantError: \(backendGrantError.summary)")
        } else {
            lines.append("backendGrantError: none")
        }

        return lines
    }

    mutating func markProductLoadStarted(
        requestedProductIds: [String],
        canMakePayments: Bool,
        storefrontCountryCode: String?,
        storefrontId: String?,
        at timestamp: String = Self.iso8601Now()
    ) {
        refreshRuntimeMetadata()
        self.requestedProductIds = requestedProductIds
        self.returnedProductCount = 0
        self.returnedProductIds = []
        self.canMakePayments = canMakePayments
        self.storefrontCountryCode = storefrontCountryCode
        self.storefrontId = storefrontId
        self.productLoadStatus = .started
        self.productLoadStartedAt = timestamp
        self.productLoadCompletedAt = nil
        self.lastProductLoadError = nil
    }

    mutating func markProductLoadCompleted(returnedProductIds: [String], at timestamp: String = Self.iso8601Now()) {
        self.returnedProductIds = returnedProductIds
        self.returnedProductCount = returnedProductIds.count
        self.productLoadStatus = returnedProductIds.isEmpty ? .empty : .success
        self.productLoadCompletedAt = timestamp
        self.lastProductLoadError = nil
    }

    mutating func markProductLoadFailed(_ error: Error, at timestamp: String = Self.iso8601Now()) {
        self.returnedProductCount = 0
        self.returnedProductIds = []
        self.productLoadStatus = .failed
        self.productLoadCompletedAt = timestamp
        self.lastProductLoadError = StoreKitDiagnosticsError(error: error)
    }

    mutating func markPurchaseStarted(productId: String) {
        latestPurchaseStatus = "started:\(productId)"
        latestPurchaseError = nil
        backendGrantStatus = "not_started"
        backendGrantError = nil
    }

    mutating func markPurchaseStatus(_ status: String) {
        latestPurchaseStatus = status
    }

    mutating func markPurchaseFailed(_ error: Error) {
        latestPurchaseStatus = "failed"
        latestPurchaseError = StoreKitDiagnosticsError(error: error)
    }

    mutating func markBackendGrantStatus(_ status: String) {
        backendGrantStatus = status
        if status == "started" || status == "succeeded" || status == "already_granted" {
            backendGrantError = nil
        }
    }

    mutating func markBackendGrantFailed(_ error: Error) {
        backendGrantStatus = "failed"
        backendGrantError = StoreKitDiagnosticsError(error: error)
    }

    mutating func markTransactionFinished() {
        latestPurchaseStatus = "transaction_finished"
    }

    mutating func updatePurchaseButtonVisibilityReason(_ reason: String) {
        purchaseButtonVisibilityReason = reason
    }

    private mutating func refreshRuntimeMetadata() {
        appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? appVersion
        buildNumber = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? buildNumber
        bundleIdentifier = Bundle.main.bundleIdentifier ?? bundleIdentifier
        buildConfiguration = Self.currentBuildConfiguration
        runtimeMode = Self.currentRuntimeMode
        localStoreKitConfigurationStatus = Self.localStoreKitConfigurationStatus()
    }

    private static var currentBuildConfiguration: String {
        #if DEBUG
        "DEBUG"
        #else
        "RELEASE"
        #endif
    }

    private static var currentRuntimeMode: String {
        #if DEBUG
        "debug"
        #else
        "release"
        #endif
    }

    private static func localStoreKitConfigurationStatus() -> String {
        let environment = ProcessInfo.processInfo.environment
        if environment["STOREKIT_CONFIGURATION_FILE"] != nil {
            return "environment_present"
        }
        return "not_detected"
    }

    private static func iso8601Now() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}

extension StoreKitDiagnosticsError {
    var summary: String {
        "\(type) domain=\(domain) code=\(code) message=\(message)"
    }
}
