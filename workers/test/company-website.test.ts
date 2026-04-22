import { describe, expect, it } from "vitest";
import { extractCompanyWebsiteUrl } from "../src/lib/filings/company-website";

describe("extractCompanyWebsiteUrl", () => {
  it("prefers company investor pages over SEC links", () => {
    const html = `
      <html>
        <body>
          <p>
            Available Information. We make information available on our investor relations website at
            <a href="https://investor.circle.com">investor.circle.com</a>.
          </p>
          <p>
            The filing is available on
            <a href="https://www.sec.gov/Archives/edgar/data/1/test.htm">sec.gov</a>.
          </p>
        </body>
      </html>
    `;

    expect(
      extractCompanyWebsiteUrl(html, {
        companyName: "Circle Internet Group, Inc.",
        primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1/test.htm"
      })
    ).toBe("https://investor.circle.com/");
  });

  it("falls back to bare company domains in filing text", () => {
    const html = `
      <html>
        <body>
          <p>Our website address is www.apple.com and our investor updates are posted there.</p>
        </body>
      </html>
    `;

    expect(
      extractCompanyWebsiteUrl(html, {
        companyName: "Apple Inc.",
        primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1/test.htm"
      })
    ).toBe("https://www.apple.com/");
  });
});
