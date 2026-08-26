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

const tenQWithHeavyInlineAssets = `
  <html>
    <head>
      <style>${".toc{display:none;}".repeat(400)}</style>
      <script>${"window.__INLINE_DATA__='x';".repeat(400)}</script>
    </head>
    <body>
      <!-- TABLE OF CONTENTS Item 2. Management's Discussion and Analysis -->
      <h2>Part I - Financial Information</h2>
      <h3>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</h3>
      <p>${"Subscription growth improved and churn remained stable across enterprise cohorts. ".repeat(100)}</p>
      <h3>Item 3. Quantitative and Qualitative Disclosures About Market Risk</h3>
    </body>
  </html>
`;

/// 20-F の本文は「Item 5. Operating and Financial Review and Prospects」で始まり
/// 「Item 6. Directors, Senior Management and Employees」で終わる。
/// TSMC は様式名と違って "Reviews"(複数形)で書く。
const twentyF = `
  <html><body>
    <div>ITEM 4A. UNRESOLVED STAFF COMMENTS None</div>
    <h2>ITEM 5. OPERATING AND FINANCIAL REVIEWS AND PROSPECTS</h2>
    <p>The following discussion covers the fiscal years ended December 31, 2025 and 2024.</p>
    <p>${"Net revenue grew on strong demand for leading-edge process technologies. ".repeat(120)}</p>
    <h2>ITEM 6. DIRECTORS, SENIOR MANAGEMENT AND EMPLOYEES</h2>
    <p>Members of the board are elected by the shareholders.</p>
  </body></html>
`;

/// 相互参照(「"Item 5 ... – 小節名" を参照」)を章の入口と取り違えないこと。
/// これを許すと SAP では Item 4 のサステナビリティ記述を財務レビューとして
/// 38,000 字抜いてしまう(2026-08-24 に実物で確認)。
const twentyFWithCrossReferenceBeforeTheSection = `
  <html><body>
    <div>
      For our sustainability approach see “Item 5. Operating and Financial Review and Prospects – Expected Developments.”
      ${"Our data protection and cloud compliance program covers every regional data centre. ".repeat(120)}
    </div>
    <h2>ITEM 5. OPERATING AND FINANCIAL REVIEW AND PROSPECTS</h2>
    <p>${"Cloud revenue grew while license revenue continued its planned decline. ".repeat(120)}</p>
    <h2>ITEM 6. DIRECTORS, SENIOR MANAGEMENT AND EMPLOYEES</h2>
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

  it("ignores inline scripts, styles, and comments before extracting the 10-Q MD&A", () => {
    const result = extractMDASection(tenQWithHeavyInlineAssets, "10-Q");
    expect(result).not.toBeNull();
    expect(result?.text).toContain("Subscription growth improved and churn remained stable");
    expect(result?.text).not.toContain("window.__INLINE_DATA__");
    expect(result?.text).not.toContain(".toc{display:none;}");
  });

  it("reads the 20-F review section, including the plural heading TSMC actually files", () => {
    const extracted = extractMDASection(twentyF, "20-F");
    expect(extracted).not.toBeNull();
    expect(extracted?.text).toContain("OPERATING AND FINANCIAL REVIEWS AND PROSPECTS");
    expect(extracted?.text).toContain("leading-edge process technologies");
    // 次章に入り込まない
    expect(extracted?.text).not.toContain("Members of the board are elected");
  });

  it("does not mistake a 20-F cross-reference for the start of the section", () => {
    const extracted = extractMDASection(twentyFWithCrossReferenceBeforeTheSection, "20-F");
    expect(extracted).not.toBeNull();
    expect(extracted?.text).toContain("Cloud revenue grew");
    // 相互参照から始めると、その手前の別章の記述を財務レビューとして引用してしまう
    expect(extracted?.text).not.toContain("data protection and cloud compliance");
  });

  it("returns nothing for a 20-F that indexes its own annual report instead of carrying Item headings", () => {
    // ASML と Shell はこの形。抜けない方が、別の章を財務レビューと偽るより良い。
    const crossReferenceIndexOnly = `
      <html><body>
        <div>Item 5. Operating and Financial Review and Prospects A. Operating results 23-30, 36-41 B. Liquidity 38-41</div>
        <div>Financial performance – Performance KPIs ${"Revenue for the year increased on higher system sales. ".repeat(120)}</div>
      </body></html>
    `;
    expect(extractMDASection(crossReferenceIndexOnly, "20-F")).toBeNull();
  });
});
