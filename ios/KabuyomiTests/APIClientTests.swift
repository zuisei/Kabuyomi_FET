import Foundation
import XCTest
@testable import Kabuyomi

final class APIClientTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testSearchBuildsQueryRequest() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/search?q=MSFT")
            XCTAssertEqual(request.httpMethod, "GET")
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, try TestFixtures.searchResponseData())
        }

        let items = try await client.search(query: "MSFT")

        XCTAssertEqual(items.map(\.ticker), ["MSFT"])
    }

    func testAddToWatchlistSendsDeviceHeaderAndJSONBody() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/watchlist/add")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-debug-unlimited"))
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["ticker"], "AAPL")

            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, try TestFixtures.watchlistAddResponseData())
        }

        let response = try await client.addToWatchlist(ticker: "AAPL", deviceKey: "device-123")

        XCTAssertEqual(response.company.ticker, "AAPL")
        XCTAssertEqual(response.usage.stocksUsed, 1)
    }

    func testFetchUsageIncludesDebugUnlimitedHeaderWhenEnabled() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/usage")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-debug-unlimited"), "1")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "beta",
                    "chatsUsed": 1,
                    "chatLimit": 20,
                    "stocksUsed": 1,
                    "stockLimit": 25,
                    "dateJST": "2026-04-17"
                ])
            )
        }

        let usage = try await client.fetchUsage(deviceKey: "device-123", debugUnlimited: true)

        XCTAssertEqual(usage.chatsUsed, 1)
        XCTAssertEqual(usage.chatLimit, 20)
    }

    private func makeClient(
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> APIClient {
        MockURLProtocol.requestHandler = handler

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)

        return APIClient(
            session: session,
            baseURL: URL(string: "https://example.com")!
        )
    }

    private nonisolated static func requestBodyData(from request: URLRequest) -> Data? {
        if let httpBody = request.httpBody {
            return httpBody
        }

        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }

        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        var data = Data()
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 {
                break
            }
            data.append(buffer, count: read)
        }

        return data.isEmpty ? nil : data
    }
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
