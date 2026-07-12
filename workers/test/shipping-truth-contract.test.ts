import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("authoritative shipping truth contract", () => {
  it("keeps current docs aligned with safe release capabilities", () => {
    const truth = read("docs/release/CURRENT_SHIPPING_TRUTH.md");
    const index = read("docs/INDEX.md");
    const review = read("docs/release/APP_STORE_SUBMISSION_NOTES.md");
    const readme = read("README.md");

    expect(truth).toContain("50 credits once for a verified App Attest installation; never recurring");
    expect(truth).toContain("| Free | 0 monthly credits");
    expect(truth).toContain("`creditBillingEnabled=false`");
    expect(truth).toContain("Sign in with Apple account principals");
    expect(truth).toContain("complete, typed, dated envelope");
    expect(truth).toContain("Missing, malformed, partial, unsupported, or stale configuration");
    expect(index).toContain("Current truth is [release/CURRENT_SHIPPING_TRUTH.md]");
    expect(index).not.toContain("release-visible optional rewarded ads");
    expect(review).toContain("Status: HOLD");
    expect(readme).toContain("reset does not create a new welcome balance");
    expect(readme).not.toMatch(/reset.{0,80}(regenerat|new device identity)/iu);
    expect(readme).not.toContain("currently trusts the client-provided `x-device-key`");
    expect(readme).toContain("deployed capability surfaces require a fresh trusted full config with explicit typed fields");
    expect(readme).not.toContain("legacy-config compatibility mode");
  });

  it("keeps current legal pages free of hard-coded shipping prices", () => {
    const legal = [
      read("legal-site/public/privacy/index.html"),
      read("legal-site/public/terms/index.html"),
      read("legal-site/public/tokushoho/index.html")
    ].join("\n");
    expect(legal).not.toMatch(/(?:JPY\s*[\d,]+|[¥￥]\s*[\d,]+|\$(?!0\b)\s*\d|[\d,]+\s*円)/iu);
  });
});
