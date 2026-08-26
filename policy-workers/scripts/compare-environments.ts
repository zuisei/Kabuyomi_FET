import { buildEnvironmentSnapshot, compareEnvironmentSnapshots, type ParityEventSummary } from "../src/environment-parity.ts";

type APIEnvelope = {
  data: ParityEventSummary[];
  pagination?: { nextCursor?: string | null };
};

async function loadAll(baseURL: string): Promise<ParityEventSummary[]> {
  const events: ParityEventSummary[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL("/v1/events", baseURL);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${url.origin} returned HTTP ${response.status}`);
    const envelope = await response.json() as APIEnvelope;
    events.push(...envelope.data);
    cursor = envelope.pagination?.nextCursor ?? null;
  } while (cursor !== null);
  return events;
}

const argumentsWithoutFlags = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const testFlightURL = argumentsWithoutFlags[0] ?? process.env.MARKET_DOCKET_TESTFLIGHT_API_URL ?? "https://md-api-testflight.dznqjmctk7.workers.dev";
const productionURL = argumentsWithoutFlags[1] ?? process.env.MARKET_DOCKET_PRODUCTION_API_URL ?? "https://md-api-prod.dznqjmctk7.workers.dev";
const allowDrift = process.argv.includes("--allow-drift");

const [testFlightEvents, productionEvents] = await Promise.all([loadAll(testFlightURL), loadAll(productionURL)]);
const result = compareEnvironmentSnapshots(
  buildEnvironmentSnapshot("TestFlight", testFlightEvents),
  buildEnvironmentSnapshot("Production", productionEvents)
);
const full = process.argv.includes("--full");
const printable = full ? result : {
  matches: result.matches,
  differences: result.differences,
  left: { ...result.left, ids: undefined },
  right: { ...result.right, ids: undefined },
  missingFromLeftCount: result.missingFromLeft.length,
  missingFromRightCount: result.missingFromRight.length,
  missingFromLeftSample: result.missingFromLeft.slice(0, 20),
  missingFromRightSample: result.missingFromRight.slice(0, 20)
};
console.log(JSON.stringify(printable, null, 2));
if (!result.matches && !allowDrift) process.exitCode = 1;
