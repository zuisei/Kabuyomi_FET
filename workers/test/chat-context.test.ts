import { describe, expect, it } from "vitest";
import { resolveContextualQuestion } from "../src/lib/chat/context";

describe("resolveContextualQuestion", () => {
  const cashFlowContext = [
    { role: "user" as const, content: "営業CF" },
    { role: "assistant" as const, content: "営業キャッシュフローはマイナスで、前年比で減少しました。" }
  ];

  it("anchors bare cause follow-ups to the previous metric", () => {
    expect(resolveContextualQuestion("なぜ？", cashFlowContext)).toBe("営業CFが変化した理由は？");
  });

  it("anchors durability follow-ups to the previous metric", () => {
    expect(resolveContextualQuestion("その要因は一時的？", cashFlowContext)).toBe("営業CFが変化した要因は一時的ですか？");
  });

  it("leaves explicit metric questions unchanged", () => {
    expect(resolveContextualQuestion("売上高はなぜ伸びた？", cashFlowContext)).toBe("売上高はなぜ伸びた？");
  });
});
