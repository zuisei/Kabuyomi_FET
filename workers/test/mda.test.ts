import { describe, expect, it } from "vitest";
import { extractMDASection } from "../src/extractors/mda";

const tenK = `
  <html><body>
    <h1>TABLE OF CONTENTS</h1>
    <p>Item 7. Management's Discussion and Analysis</p>
    <p>Short TOC mention.</p>
    <h2>Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations</h2>
    <p>${"Revenue improved due to services mix. ".repeat(160)}</p>
    <h2>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</h2>
  </body></html>
`;

const tenQ = `
  <html><body>
    <h2>Part I - Financial Information</h2>
    <h3>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</h3>
    <p>${"Gross margin declined because of channel inventory adjustments. ".repeat(120)}</p>
    <h3>Item 3. Quantitative and Qualitative Disclosures About Market Risk</h3>
  </body></html>
`;

const tenQCurlyApostrophe = `
  <html><body>
    <h1>TABLE OF CONTENTS</h1>
    <p>PagePart IItem 2.Management’s Discussion and Analysis of Financial Condition and Results of Operations13</p>
    <p>Part IItem 1.Financial Statements1</p>
    <h2>Part I - Financial Information</h2>
    <h3>Apple Inc. | Q1 2026 Form 10-Q | 12Item 2. Management’s Discussion and Analysis of Financial Condition and Results of Operations</h3>
    <p>${"iPhone revenue increased while Services remained resilient across regions. ".repeat(120)}</p>
    <h3>Item 3. Quantitative and Qualitative Disclosures About Market Risk</h3>
  </body></html>
`;

describe("extractMDASection", () => {
  it("extracts the 10-K MD&A and skips short TOC matches", () => {
    const result = extractMDASection(tenK, "10-K");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("Revenue improved");
    expect(result?.text).not.toContain("Short TOC mention");
  });

  it("extracts the 10-Q MD&A", () => {
    const result = extractMDASection(tenQ, "10-Q");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("Gross margin declined");
  });

  it("extracts the 10-Q MD&A when the filing uses a curly apostrophe", () => {
    const result = extractMDASection(tenQCurlyApostrophe, "10-Q");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("iPhone revenue increased");
    expect(result?.text).not.toContain("TABLE OF CONTENTS");
  });
});
