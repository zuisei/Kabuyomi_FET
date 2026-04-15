import http from "node:http";
import { createSecService, readConfig, validateInternalToken } from "./src/sec-service.mjs";

const port = Number.parseInt(process.env.PORT ?? "8789", 10);
const host = process.env.HOST ?? "0.0.0.0";
const config = readConfig();
const service = createSecService(config);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return respondJson(response, 200, { ok: true });
    }

    if (request.method !== "POST") {
      return respondJson(response, 405, { error: "Method not allowed" });
    }

    if (!validateInternalToken(request.headers, config)) {
      return respondJson(response, 401, { error: "Unauthorized" });
    }

    const body = await readJson(request);

    if (request.url === "/internal/sec/tickers-snapshot") {
      const payload = await service.fetchTickerSnapshot();
      return respondJson(response, 200, payload);
    }

    if (request.url === "/internal/sec/submissions") {
      const cik = String(body?.cik ?? "").trim();
      if (!cik) {
        return respondJson(response, 400, { error: "cik is required" });
      }
      const payload = await service.fetchSubmissions(cik);
      return respondJson(response, 200, payload);
    }

    if (request.url === "/internal/sec/filing") {
      const cik = String(body?.cik ?? "").trim();
      const accessionNumber = String(body?.accessionNumber ?? "").trim();
      const primaryDocument = String(body?.primaryDocument ?? "").trim();
      if (!cik || !accessionNumber || !primaryDocument) {
        return respondJson(response, 400, { error: "cik, accessionNumber, and primaryDocument are required" });
      }
      const payload = await service.fetchFiling({ cik, accessionNumber, primaryDocument });
      return respondJson(response, 200, payload);
    }

    if (request.url === "/internal/sec/metrics") {
      const cik = String(body?.cik ?? "").trim();
      const tags = Array.isArray(body?.tags) ? body.tags.map((tag) => String(tag)) : [];
      if (!cik) {
        return respondJson(response, 400, { error: "cik is required" });
      }
      const payload = await service.fetchMetrics({ cik, tags });
      return respondJson(response, 200, payload);
    }

    if (request.url === "/internal/sec/filing-assets") {
      const cik = String(body?.cik ?? "").trim();
      const accessionNumber = String(body?.accessionNumber ?? "").trim();
      const primaryDocument = String(body?.primaryDocument ?? "").trim();
      const tags = Array.isArray(body?.tags) ? body.tags.map((tag) => String(tag)) : [];
      if (!cik || !accessionNumber || !primaryDocument) {
        return respondJson(response, 400, { error: "cik, accessionNumber, and primaryDocument are required" });
      }
      const payload = await service.fetchFilingAssets({ cik, accessionNumber, primaryDocument, tags });
      return respondJson(response, 200, payload);
    }

    return respondJson(response, 404, { error: "Not found" });
  } catch (error) {
    return respondJson(response, 502, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ event: "sec_fetcher_started", host, port }));
});

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
