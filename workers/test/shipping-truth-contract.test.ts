import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("authoritative shipping truth contract", () => {
  it("keeps current docs aligned with the live production capabilities", () => {
    const truth = read("docs/release/CURRENT_SHIPPING_TRUTH.md");
    const index = read("docs/INDEX.md");
    const review = read("docs/release/APP_STORE_SUBMISSION_NOTES.md");
    const readme = read("README.md");

    expect(truth).toContain("50 credits once for a verified App Attest installation; never recurring");
    expect(truth).toContain("| Free | 0 monthly credits");
    expect(truth).toContain("`creditBillingEnabled=true`");
    expect(truth).toContain("`consumablePurchasesEnabled=true`");
    expect(truth).toContain("`rewardedCreditEnabled=true`");
    expect(truth).toContain("`rewardedSsvReady=true`");
    expect(truth).toContain("`accountRecoveryReady=false`");
    expect(truth).toContain("external lifecycle evidence");
    expect(truth).toContain("Sign in with Apple account principals");
    expect(truth).toContain("complete, typed, dated envelope");
    expect(truth).toContain("Missing, malformed, partial, unsupported, or stale configuration");
    // 索引が出荷状態の正を指していること。**文面ではなくリンクで確かめる** —
    // 2026-08-25 に索引を日本語で書き直したとき、英文だけを見ていたこの表明が
    // 「正を指していない」ではなく「英語が消えた」で落ちた。
    expect(index).toContain("release/CURRENT_SHIPPING_TRUTH.md");
    expect(index).toMatch(/正|authoritative|Current truth/u);
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
