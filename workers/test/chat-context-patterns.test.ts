import { describe, expect, it } from "vitest";
import {
  businessContextPattern,
  isAccountingEstimateRiskDistractor,
  revenueDriverPattern,
  riskContextPattern
} from "../src/lib/chat/context-patterns";

describe("chat context patterns", () => {
  it("keeps intent pattern responsibilities outside context-pack scoring", () => {
    expect(businessContextPattern().test("We provide cloud services to enterprise customers.")).toBe(true);
    expect(revenueDriverPattern().test("Revenue increased primarily due to higher net sales of products.")).toBe(true);
    expect(riskContextPattern().test("Risk factors include cybersecurity and supply disruption.")).toBe(true);
  });

  it("keeps accounting estimate risk distractors separate from real risk sections", () => {
    expect(isAccountingEstimateRiskDistractor("goodwill impairment fair value annual basis future cash flows")).toBe(true);
    expect(isAccountingEstimateRiskDistractor("Item 1A Risk Factors include goodwill impairment risk.")).toBe(false);
  });
});
