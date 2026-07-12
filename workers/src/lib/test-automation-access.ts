import type { Env } from "../env";

export interface TestAutomationAccessGrant {
  quotaSubject: string;
  accessMode: "dev_unlimited";
  chatLimitOverride: number;
  stockLimitOverride: number;
}

export const TEST_AUTOMATION_HEADER = "x-kabuyomi-test-authorization";
const TEST_AUTOMATION_LIMIT = Number.MAX_SAFE_INTEGER;

export async function loadTestAutomationAccessFromRequest(
  request: Request,
  env: Env
): Promise<TestAutomationAccessGrant | null> {
  if (!isDedicatedTestEnvironment(env)) return null;

  const configured = env.TEST_AUTOMATION_SHARED_SECRET?.trim();
  const supplied = request.headers.get(TEST_AUTOMATION_HEADER)?.trim() ?? "";
  if (!configured || !timingSafeEqual(configured, supplied)) return null;

  return {
    quotaSubject: `pro:test-automation:${await sha256Hex(`test-automation\0${configured}`)}`,
    accessMode: "dev_unlimited",
    chatLimitOverride: TEST_AUTOMATION_LIMIT,
    stockLimitOverride: TEST_AUTOMATION_LIMIT
  };
}

export function isDedicatedTestEnvironment(env: Pick<Env, "KABUYOMI_ENV" | "ENVIRONMENT">): boolean {
  return env.KABUYOMI_ENV?.trim().toLowerCase() === "test"
    && env.ENVIRONMENT?.trim().toLowerCase() === "test";
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return mismatch === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
