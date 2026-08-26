import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The production chat prompt lives in the OpenAI dashboard, not in this repo:
 * when OPENAI_PROMPT_ID is set, client.ts calls invokeOpenAIDashboardPrompt and
 * buildChatPrompt in prompts.ts is never sent. src/clients/llm/providers/openai/
 * production-prompt/ holds a byte-exact copy so the instructions that actually
 * reach the model can be read from the repository.
 *
 * What this test can catch: wrangler.toml drifting away from the copy's prompt
 * id or version, and the copy being edited without re-capturing it.
 *
 * What it cannot catch: someone editing the prompt in the dashboard. That
 * changes production behaviour with no commit, review, or deploy, and no test
 * here can see it. Re-capture the copy periodically and diff it.
 */

const workers = resolve(__dirname, "..");
const PROMPT_ID = "pmpt_69f5f2f592b8819490c30cf43c4f0f770f3a1fc228661050";
const PROMPT_VERSION = "2";
const DEVELOPER_PROMPT_SHA256 = "7b426ce7250fbc3a0e6dd0c156b9164c9bffb305f6d0ae57e16513fa89c53924";
const DEVELOPER_PROMPT_LENGTH = 7567;

function readWranglerValue(file: string, key: string): string | null {
  const source = readFileSync(resolve(workers, file), "utf8");
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "mu"));
  return match ? match[1]! : null;
}

describe("OpenAI production prompt snapshot", () => {
  const snapshot = readFileSync(
    resolve(workers, "src/clients/llm/providers/openai/production-prompt/pmpt_69f5f2f5.v2.developer.txt"),
    "utf8"
  );

  it("keeps the captured developer prompt byte-exact", () => {
    expect(snapshot).toHaveLength(DEVELOPER_PROMPT_LENGTH);
    expect(snapshot.endsWith("\n")).toBe(false);
    expect(createHash("sha256").update(snapshot, "utf8").digest("hex")).toBe(DEVELOPER_PROMPT_SHA256);
  });

  it("states the rules the product's source-backed claim depends on", () => {
    // Not a paraphrase check — these exact lines are why the chat path can be
    // called source-bound at all. If a re-capture drops one, that is the signal.
    expect(snapshot).toContain("You must not invent facts.");
    expect(snapshot).toContain("You must not use outside knowledge.");
    expect(snapshot).toContain("Use only sourceIds that exist in the provided Sources list.");
    expect(snapshot).toContain("If no provided source supports a statement, do not include that statement.");
    expect(snapshot).toContain("You must not provide investment advice");
  });

  for (const file of ["wrangler.toml", "wrangler.test.toml"]) {
    it(`pins the prompt id and version configured in ${file}`, () => {
      expect(readWranglerValue(file, "OPENAI_PROMPT_ID")).toBe(PROMPT_ID);
      expect(readWranglerValue(file, "OPENAI_PROMPT_VERSION")).toBe(PROMPT_VERSION);
    });
  }
});
