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

  it("keeps the user's revenue anchor when the assistant mentions profit metrics as non-driver context", () => {
    const revenueContext = [
      { role: "user" as const, content: "売上成長の要因は？" },
      {
        role: "assistant" as const,
        content:
          "売上成長の要因は、この資料から直接確認できる売上高指標や要因説明が不足しているため断定できません。純利益や営業利益の数字はありますが、売上成長の主因としては使わない方が安全です。"
      }
    ];

    expect(resolveContextualQuestion("その要因は一時的？", revenueContext)).toBe("売上高が変化した要因は一時的ですか？");
  });
});
