import { describe, expect, it } from "vitest";
import {
  isDedicatedTestEnvironment,
  loadTestAutomationAccessFromRequest,
  TEST_AUTOMATION_HEADER
} from "../src/lib/test-automation-access";

const secret = "test-secret-with-sufficient-entropy-0123456789";

describe("test automation access", () => {
  it("accepts the shared secret only in the dedicated dual-test environment", async () => {
    const grant = await loadTestAutomationAccessFromRequest(
      new Request("https://kabuyomi.test/v1/chat", {
        headers: { [TEST_AUTOMATION_HEADER]: secret }
      }),
      {
        KABUYOMI_ENV: "test",
        ENVIRONMENT: "test",
        TEST_AUTOMATION_SHARED_SECRET: secret
      } as never
    );

    expect(grant).toMatchObject({
      quotaSubject: expect.stringMatching(/^pro:test-automation:[a-f0-9]{64}$/),
      accessMode: "dev_unlimited",
      chatLimitOverride: Number.MAX_SAFE_INTEGER,
      stockLimitOverride: Number.MAX_SAFE_INTEGER
    });
  });

  it.each([
    { KABUYOMI_ENV: "production", ENVIRONMENT: "test" },
    { KABUYOMI_ENV: "test", ENVIRONMENT: "production" },
    { KABUYOMI_ENV: "production", ENVIRONMENT: "production" },
    { KABUYOMI_ENV: "test", ENVIRONMENT: undefined }
  ])("rejects the same secret outside a dual-test environment: %o", async (environment) => {
    const grant = await loadTestAutomationAccessFromRequest(
      new Request("https://kabuyomi.test/v1/chat", {
        headers: { [TEST_AUTOMATION_HEADER]: secret }
      }),
      { ...environment, TEST_AUTOMATION_SHARED_SECRET: secret } as never
    );
    expect(grant).toBeNull();
  });

  it("rejects a missing or incorrect secret", async () => {
    const env = {
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test",
      TEST_AUTOMATION_SHARED_SECRET: secret
    } as never;
    await expect(loadTestAutomationAccessFromRequest(
      new Request("https://kabuyomi.test/v1/chat"), env
    )).resolves.toBeNull();
    await expect(loadTestAutomationAccessFromRequest(
      new Request("https://kabuyomi.test/v1/chat", {
        headers: { [TEST_AUTOMATION_HEADER]: `${secret}-wrong` }
      }), env
    )).resolves.toBeNull();
  });

  it("requires both explicit test markers", () => {
    expect(isDedicatedTestEnvironment({ KABUYOMI_ENV: "test", ENVIRONMENT: "test" })).toBe(true);
    expect(isDedicatedTestEnvironment({ KABUYOMI_ENV: "test", ENVIRONMENT: "production" })).toBe(false);
    expect(isDedicatedTestEnvironment({ KABUYOMI_ENV: "production", ENVIRONMENT: "test" })).toBe(false);
  });
});
