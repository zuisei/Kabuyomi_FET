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

const tenKBodyHeadingWithoutItemNumber = `
  <html><body>
    <div>
      Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations:
      Liquidity and capital resources Pages 29-32
      Results of operations Pages 18-29
      Critical accounting estimates Pages 34-36
      Item 7A. Quantitative and Qualitative Disclosures About Market Risk Pages 33
    </div>
    <div>
      Glossary MD&A Management's Discussion and Analysis Mentee Robotics Marketing, general, and administrative
    </div>
    <div>
      Management's Discussion and Analysis Overview
      Our MD&A begins with an overview of significant events and key developments that meaningfully impacted our financial results.
      We then provide a detailed discussion of our operating segment results, followed by our consolidated results of operations and
      liquidity and capital resources. We conclude with a discussion of our critical accounting estimates.
      ${"Operating segment results improved due to product mix, pricing, and lower inventory charges. ".repeat(80)}
      ${"Liquidity and capital resources remained sufficient to fund operations and investments. ".repeat(50)}
    </div>
    <div>
      Quantitative and Qualitative Disclosures About Market Risk
      We are affected by changes in currency exchange and interest rates.
    </div>
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

const tenQInlineItemReference = `
  <html><body>
    <h1>TABLE OF CONTENTS</h1>
    <p>Item 2. Management’s Discussion and Analysis of Financial Condition and Results of Operations 30</p>
    <p>Item 3. Quantitative and Qualitative Disclosures About Market Risk 46</p>
    <h2>ITEM 2. MANAGEMENT’S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS</h2>
    <p>${"This report includes estimates, projections and other forward-looking statements, including references to Part I, Item 3 of this Form 10-Q. ".repeat(40)}</p>
    <p>${"Cloud revenue grew due to Azure demand and enterprise renewals. ".repeat(60)}</p>
    <h3>ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK</h3>
  </body></html>
`;

const tenQInlineHeadingBoundary = `
  <html><body><div>Apple Inc.Form 10-QFor the Fiscal Quarter Ended December 27, 2025 TABLE OF CONTENTSPagePart IItem 1.Financial Statements1Item 2.Management’s Discussion and Analysis of Financial Condition and Results of Operations13Item 3.Quantitative and Qualitative Disclosures About Market Risk18Item 4.Controls and Procedures18</div><div>Apple Inc. | Q1 2026 Form 10-Q | 12Item 2. Management’s Discussion and Analysis of Financial Condition and Results of Operations ${"Services revenue increased while iPhone demand remained strong across key regions. ".repeat(80)} Item 3. Quantitative and Qualitative Disclosures About Market Risk</div></body></html>
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

  it("extracts the 10-K MD&A when the body heading omits Item 7 and the TOC keeps the item numbering", () => {
    const result = extractMDASection(tenKBodyHeadingWithoutItemNumber, "10-K");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("Our MD&A begins with an overview");
    expect(result?.text).toContain("Operating segment results improved due to product mix");
    expect(result?.text).not.toContain("Pages 29-32");
    expect(result?.text).not.toContain("Glossary MD&A");
  });

  it("extracts the 10-Q MD&A when the filing uses a curly apostrophe", () => {
    const result = extractMDASection(tenQCurlyApostrophe, "10-Q");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("iPhone revenue increased");
    expect(result?.text).not.toContain("TABLE OF CONTENTS");
    expect(result?.text).not.toContain("PagePart IItem 2.");
  });

  it("does not end the MD&A early when prose references Item 3", () => {
    const result = extractMDASection(tenQInlineItemReference, "10-Q");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("Cloud revenue grew due to Azure demand");
    expect(result?.text).not.toContain("TABLE OF CONTENTS");
  });

  it("extracts the 10-Q MD&A when Item 3 is inline instead of line-boundary anchored", () => {
    const result = extractMDASection(tenQInlineHeadingBoundary, "10-Q");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("Services revenue increased while iPhone demand remained strong");
    expect(result?.text).not.toContain("TABLE OF CONTENTS");
    expect(result?.text).not.toContain("PagePart IItem 1.");
  });
});
