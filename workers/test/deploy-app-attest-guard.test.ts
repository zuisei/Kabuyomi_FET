import { describe, expect, it } from "vitest";
import { assertAppAttestBundleVersionCovered } from "../scripts/deploy-worker.mjs";

describe("assertAppAttestBundleVersionCovered", () => {
  // APP_ATTEST_ALLOWED_BUNDLE_VERSIONS に入らないビルドは
  // attestation_bundle_version_not_allowed で拒否され、
  // 新規インストールが黙って restricted_installation に落ちる。
  // App Store Connect は同じビルド番号の再アップロードを拒否するので、
  // 再提出のたびにこの取りこぼしが起こりうる。
  it("passes when the iOS build number is in the allowlist", () => {
    expect(() => assertAppAttestBundleVersionCovered("6,7", "6")).not.toThrow();
    expect(() => assertAppAttestBundleVersionCovered("6, 7", "7")).not.toThrow();
  });

  it("fails when the iOS build number was bumped past the allowlist", () => {
    expect(() => assertAppAttestBundleVersionCovered("6,7", "8"))
      .toThrow(/app_attest_bundle_version_not_covered:ios_build=8/u);
  });

  it("fails when the allowlist is empty or missing", () => {
    expect(() => assertAppAttestBundleVersionCovered("", "6")).toThrow(/allowlist=empty/u);
    expect(() => assertAppAttestBundleVersionCovered(undefined, "6")).toThrow(/allowlist=empty/u);
  });

  it("fails when the iOS build number cannot be read", () => {
    expect(() => assertAppAttestBundleVersionCovered("6", undefined)).toThrow(/ios_build_number_unreadable/u);
    expect(() => assertAppAttestBundleVersionCovered("6", "  ")).toThrow(/ios_build_number_unreadable/u);
  });
});
