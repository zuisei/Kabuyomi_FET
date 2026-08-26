import assert from "node:assert/strict";
import test from "node:test";
import { matchesSearchText, normalizeSearchText } from "../src/search.ts";

test("search aliases cover tickers, agency names, and bilingual policy terms", () => {
  assert.equal(matchesSearchText("Bitcoin market reporting rule", "BTC"), true);
  assert.equal(matchesSearchText("Semiconductor export control", "chip"), true);
  assert.equal(matchesSearchText("Securities and Exchange Commission notice", "証券取引委員会"), true);
  assert.equal(matchesSearchText("証券取引委員会による提案", "SEC"), true);
  assert.equal(normalizeSearchText("final_rule / SEC"), "final rule sec");
});
