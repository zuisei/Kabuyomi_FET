import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compareReviewRowsToSourceRows, createReviewPacketRow } from "./review-row-projection.mjs";

const [runPath, outputPath] = process.argv.slice(2);
if (!runPath || !outputPath) {
  console.error("Usage: node human-review-packet.mjs <run.jsonl> <packet.json>");
  process.exit(1);
}
if (process.env.KABUYOMI_REVIEW_PACKET_OVERWRITE !== "1") {
  try {
    await access(outputPath, constants.F_OK);
    console.error(`Refusing to overwrite an existing review packet: ${outputPath}`);
    process.exit(1);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const runContents = await readFile(runPath, "utf8");
const rows = runContents.split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const expectedTickerCount = Number(rows[0]?.companyTickerCount);
const expectedTemplateCount = Number(rows[0]?.questionTemplateCount);
const expectedRows = expectedTickerCount * expectedTemplateCount;

// Release approval requires a complete human review. Sampling previously let
// malformed-but-unflagged answers escape the gate, so every rendered row and
// its returned evidence is included in the review packet.
const selected = rows.map(createReviewPacketRow);
const packet = {
  version: "human-review-packet-v2",
  sourceRun: runPath,
  sourceRunSha256: createHash("sha256").update(runContents).digest("hex"),
  runId: rows[0]?.runId ?? null,
  appVersion: rows[0]?.appVersion ?? null,
  baseURL: rows[0]?.baseURL ?? null,
  reviewPolicy: "complete_release_review",
  expectedTickerCount: Number.isInteger(expectedTickerCount) && expectedTickerCount > 0 ? expectedTickerCount : null,
  expectedTemplateCount: Number.isInteger(expectedTemplateCount) && expectedTemplateCount > 0 ? expectedTemplateCount : null,
  expectedRows: Number.isInteger(expectedRows) && expectedRows > 0 ? expectedRows : rows.length,
  totalRows: rows.length,
  selectedRows: selected.length,
  rows: selected,
  reviewAttestation: {
    version: "complete-human-review-signoff-v1",
    status: "pending",
    reviewer: null,
    signedAt: null,
    statement: "I reviewed every row and its returned evidence, and I approve this exact packet for release quality evaluation.",
    reviewedRows: 0,
    sourceRunSha256: createHash("sha256").update(runContents).digest("hex"),
    reviewContentSha256: null
  }
};
const projectionErrors = compareReviewRowsToSourceRows(packet.rows, rows);
if (projectionErrors.length > 0) {
  throw new Error(`review packet projection mismatch during creation: ${projectionErrors.join(", ")}`);
}
await writeFile(outputPath, JSON.stringify(packet, null, 2) + "\n");
console.log(`wrote all ${selected.length} review rows to ${outputPath}`);
