import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const testConfig = readFileSync(join(root, "wrangler.test.toml"), "utf8");
const productionConfig = readFileSync(join(root, "wrangler.toml"), "utf8");

const placeholderMatches = testConfig.match(/REPLACE_WITH_[A-Z0-9_]+/g) ?? [];
if (placeholderMatches.length > 0) {
  console.error("[test-config] wrangler.test.toml still contains placeholders:");
  for (const value of [...new Set(placeholderMatches)]) {
    console.error(`  - ${value}`);
  }
  console.error("[test-config] Create test KV/D1/R2 resources first, then replace the placeholders.");
  process.exit(1);
}

const productionIds = [
  ...productionConfig.matchAll(/id = "([^"]+)"/g),
  ...productionConfig.matchAll(/database_id = "([^"]+)"/g)
]
  .map((match) => match[1])
  .filter(Boolean);

const leakedProductionIds = productionIds.filter((id) => testConfig.includes(id));
if (leakedProductionIds.length > 0) {
  console.error("[test-config] wrangler.test.toml appears to reference production resource IDs:");
  for (const id of leakedProductionIds) {
    console.error(`  - ${id}`);
  }
  console.error("[test-config] Test Worker bindings must use dedicated test resources.");
  process.exit(1);
}

console.log("[test-config] wrangler.test.toml looks ready.");
