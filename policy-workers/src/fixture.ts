// 架空の政策イベント。**`local` と `preview` でしか配られない**
// (`index.ts` の `permitsFixtureFallback`)。本番と TestFlight は
// live が空でも空のまま返す。移設時にファイルも一緒に持ってきた(2026-08-26)。
import envelope from "../DemoPolicyEvents.json" with { type: "json" };
import type { PolicyEvent } from "./domain/types.ts";

export const events = envelope.events as PolicyEvent[];
const allowedAgencyCodes = new Set(["BIS", "WH", "USTR", "DOC", "FR", "GOVINFO"]);
const sha256 = /^[0-9a-f]{64}$/;

for (const event of events) {
  if (!allowedAgencyCodes.has(event.agency.code)) throw new TypeError(`Unsupported agency code: ${event.agency.code}`);
  if (!event.documentInfo || event.documentInfo.contentHash.algorithm !== "sha256" || !sha256.test(event.documentInfo.contentHash.value)) {
    throw new TypeError(`Invalid SHA-256 content hash for event ${event.id}`);
  }
}

export function eventById(id: string): PolicyEvent | undefined { return events.find((event) => event.id === id); }
