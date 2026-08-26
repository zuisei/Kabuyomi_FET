import type { PolicyEvent, ReplaySnapshot } from "./types.ts";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function atOrBefore(value: string, asOfMs: number): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= asOfMs;
}

export function replaySnapshot(event: PolicyEvent, asOf: string): ReplaySnapshot {
  if (!ISO_TIMESTAMP.test(asOf)) throw new TypeError("as_of must be an ISO-8601 timestamp");
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new TypeError("as_of must be an ISO-8601 timestamp");

  const timelineItems = event.timelineItems
    .filter((item) => atOrBefore(item.occurredAt, asOfMs))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const versions = (event.documentVersions ?? [])
    .filter((version) => atOrBefore(version.publishedAt, asOfMs))
    .sort((a, b) => a.version - b.version);
  const documents = (event.documents ?? [])
    .filter((document) => atOrBefore(document.availableAt, asOfMs))
    .sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));
  const marketSeries = event.marketSeries
    .filter((point) => atOrBefore(point.timestamp, asOfMs))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const marketSummaries = event.marketSummaries.filter((item) => atOrBefore(item.availableAt, asOfMs));
  const availableAt = (item: { occurredAt: string; availableAt?: unknown }): string => typeof item.availableAt === "string" ? item.availableAt : item.occurredAt;
  const confounders = event.confounders.filter((item) => atOrBefore(availableAt(item as { occurredAt: string; availableAt?: unknown }), asOfMs));
  const correctionNotes = event.correctionNotes.filter((item) => atOrBefore(availableAt(item as { occurredAt: string; availableAt?: unknown }), asOfMs));
  const laterFactCount = event.timelineItems.filter((item) => !atOrBefore(item.occurredAt, asOfMs)).length
    + event.confounders.filter((item) => !atOrBefore(availableAt(item as { occurredAt: string; availableAt?: unknown }), asOfMs)).length
    + event.correctionNotes.filter((item) => !atOrBefore(availableAt(item as { occurredAt: string; availableAt?: unknown }), asOfMs)).length;

  return {
    eventId: event.id,
    asOf: new Date(asOfMs).toISOString(),
    timelineItems,
    documentVersion: versions.at(-1) ?? null,
    documents,
    marketSeries,
    marketSummaries,
    confounders,
    correctionNotes,
    laterFactCount
  };
}
