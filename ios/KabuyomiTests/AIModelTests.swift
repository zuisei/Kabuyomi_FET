import XCTest
@testable import Kabuyomi

final class AIModelTests: XCTestCase {
    func testCompactLabelHidesLocalModel() {
        XCTAssertNil(AIModelName.compactLabel(for: AIModelName.local))
    }

    func testCompactLabelUsesGenericRemoteFallback() {
        XCTAssertEqual(AIModelName.compactLabel(for: AIModelName.remoteFallback), "Remote AI")
    }

    func testCompactLabelFormatsGemmaModelWithoutHardcodedAlias() {
        XCTAssertEqual(AIModelName.compactLabel(for: "gemma-4-31b-it"), "Gemma 4 31B")
    }

    func testCompactLabelFormatsFlashModelWithoutSpecialCase() {
        XCTAssertEqual(AIModelName.compactLabel(for: "gemini-2.5-flash"), "Gemini 2.5 Flash")
    }

    func testStoredRemoteModelNameFallsBackWhenMissing() {
        XCTAssertEqual(AIModelName.storedRemoteModelName(nil), AIModelName.remoteFallback)
        XCTAssertEqual(AIModelName.storedRemoteModelName("  "), AIModelName.remoteFallback)
    }

    func testStoredLegacyModelNameKeepsMissingModelBlank() {
        XCTAssertEqual(AIModelName.storedLegacyModelName(nil), "")
        XCTAssertEqual(AIModelName.storedLegacyModelName("  "), "")
        XCTAssertEqual(AIModelName.storedLegacyModelName(" gemini-2.5-flash "), "gemini-2.5-flash")
    }
}
