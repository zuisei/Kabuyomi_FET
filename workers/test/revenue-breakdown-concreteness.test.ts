import { describe, expect, it } from "vitest";
import { classifyQuestionIntent } from "../src/lib/chat/intent";

// The finalizer's "is this breakdown answer concrete?" check used a fixed
// vocabulary from the old 15-company bench; AWS was not in it, so a correct
// AWS answer was replaced by the insufficiency template. The concreteness check
// now consults the filing's own segment vocabulary (same table as intent).
// Intent classification is the public surface that exercises that table.
describe("filing vocabulary reaches both intent and concreteness", () => {
  it("recognises AWS for AMZN and Google Cloud for GOOG", () => {
    expect(classifyQuestionIntent("AWSはどう？", { ticker: "AMZN" })).toBe("segment_analysis");
    expect(classifyQuestionIntent("Google Cloudは？", { ticker: "GOOG" })).toBe("segment_analysis");
  });
});
