import assert from "node:assert/strict";
import test from "node:test";
import { FederalRegisterAdapter, mapFederalRegisterDocument, type FederalRegisterDocument } from "../src/adapters/federal-register.ts";
import { RegulationsGovAdapter } from "../src/adapters/regulations-gov.ts";
import { WhiteHouseAdapter } from "../src/adapters/white-house.ts";
import { checkRegulationsGov, whiteHouseReadModel } from "../src/discovery.ts";

const document: FederalRegisterDocument = {
  title: "Export controls for advanced semiconductors; correcting amendment",
  type: "Rule",
  abstract: "Official abstract",
  document_number: "2026-12345",
  html_url: "https://www.federalregister.gov/documents/2026/01/02/2026-12345/example",
  pdf_url: "https://www.govinfo.gov/content/pkg/FR-2026-01-02/pdf/2026-12345.pdf",
  public_inspection_pdf_url: "https://public-inspection.federalregister.gov/2026-12345.pdf",
  publication_date: "2026-01-02",
  effective_on: "2026-02-01",
  comments_close_on: "2026-03-01",
  agencies: [{ short_name: "BIS", raw_name: "Bureau of Industry and Security" }],
  docket_ids: ["BIS-2026-0001"],
  regulation_id_numbers: ["0694-AJ00"],
  cfr_references: [{ title: 15, part: 744 }]
};

test("Federal Register adapter requests official evidence and relationship fields", async () => {
  let requested: URL | undefined;
  const adapter = new FederalRegisterAdapter(async (input) => {
    requested = new URL(String(input));
    return new Response(JSON.stringify({ count: 1, results: [document] }), { status: 200 });
  });
  const result = await adapter.discover(100);
  assert.equal(result.length, 1);
  assert.equal(requested?.searchParams.get("per_page"), "100");
  assert.ok(requested?.searchParams.getAll("fields[]").includes("docket_ids"));
  assert.ok(requested?.searchParams.getAll("fields[]").includes("pdf_url"));
});

test("Federal Register mapping preserves date-only precision inputs and GovInfo PDF", () => {
  const mapped = mapFederalRegisterDocument(document);
  assert.equal(mapped.instrumentType, "correcting_amendment");
  assert.equal(mapped.domainSlug, "export-controls-sanctions");
  assert.equal(mapped.govInfoPDFURL, document.pdf_url);
  assert.equal(mapped.effectiveOn, "2026-02-01");
  assert.equal(mapped.commentsCloseOn, "2026-03-01");
  assert.deepEqual(mapped.docketIDs, ["BIS-2026-0001"]);
});

test("Federal Register mapping uses readable agency codes", () => {
  const mapped = mapFederalRegisterDocument({
    title: "Trade action", type: "Notice", abstract: null, document_number: "2026-00002",
    html_url: "https://www.federalregister.gov/d/2026-00002", pdf_url: null,
    public_inspection_pdf_url: null, publication_date: "2026-07-21",
    agencies: [{ raw_name: "EXECUTIVE OFFICE OF THE PRESIDENT", slug: "executive-office-of-the-president" }]
  });
  assert.equal(mapped.agencyCode, "EOP");
});

test("Regulations.gov never falls back to DEMO_KEY", async () => {
  const adapter = new RegulationsGovAdapter();
  assert.equal(adapter.health, "missing_credentials");
  await assert.rejects(adapter.discover(1), /API_KEY is required/);
});

test("Regulations.gov health records a credential gate instead of using an exploration key", async () => {
  let statement = "";
  let parameters: unknown[] = [];
  const ops = {
    prepare(sql: string) {
      statement = sql;
      return {
        bind(...values: unknown[]) {
          parameters = values;
          return { async run() { return { success: true, meta: {} }; } };
        }
      };
    }
  } as unknown as D1Database;
  const result = await checkRegulationsGov({ OPS: ops } as any);
  assert.equal(result.state, "missing_credentials");
  assert.match(statement, /missing_credentials/);
  assert.match(String(parameters[1]), /REGULATIONS_GOV_API_KEY/);
});

test("White House adapter reads the official presidential actions feed", async () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title>America&amp;#8217;s Executive Order Test</title><link>https://www.whitehouse.gov/presidential-actions/test/</link><guid>wh-test</guid><pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const adapter = new WhiteHouseAdapter(async () => new Response(xml, { status: 200 }));
  const items = await adapter.discover(20);
  assert.deepEqual(items, [{ id: "wh-test", title: "America’s Executive Order Test", url: "https://www.whitehouse.gov/presidential-actions/test/", publishedAt: "2026-07-20T12:00:00.000Z" }]);
});

test("White House discovery preserves the official second and never turns it into day precision", async () => {
  const model = await whiteHouseReadModel({
    id: "wh-defense-supply-chain",
    title: "Securing America's Defense Supply Chains",
    url: "https://www.whitehouse.gov/presidential-actions/2026/07/securing-americas-defense-supply-chains/",
    publishedAt: "2026-07-20T19:38:18.000Z",
    modifiedAt: "2026-07-20T19:40:19.000Z"
  }, "2026-07-20T19:40:00.000Z") as any;
  assert.equal(model.publishedAt, "2026-07-20T19:38:18.000Z");
  assert.equal(model.timestampState, "officialExact");
  assert.equal(model.documents[0].timePrecision, "exact");
  assert.equal(model.documents[0].availabilityBasis, "source_stated");
  assert.equal(model.documents[0].currentRevision, 2);
  assert.equal(model.documentVersions.length, 2);
  assert.equal(model.timelineItems[1].kind, "documentRevision");
});
