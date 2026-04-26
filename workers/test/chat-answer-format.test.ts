import { describe, expect, it } from "vitest";
import { formatChatAnswerForDisplay } from "../src/lib/chat/answer-format";

describe("chat answer display formatting", () => {
  it("splits long Japanese prose into readable paragraphs", () => {
    const answer =
      "会社コメントの要点として、インフラの更新と拡大、および再生可能エネルギーへの移行が強調されています。" +
      "具体的には、サウスカロライナ州でのエネルギー需要の増加に対応するためのインフラ整備に投資する計画です。" +
      "また、バージニア州での洋上風力発電プロジェクトも進めています。" +
      "数字とのつながりでは、売上高と純利益が増加しており、これらの投資計画を支える財務基盤が強化されています。" +
      "注意点としては、天候や規制などの外部要因が業績に影響する可能性があります。";

    const formatted = formatChatAnswerForDisplay(answer);

    expect(formatted).toContain("\n\n");
    expect(formatted.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps short answers compact", () => {
    const answer = "AAPLはiPhoneやサービスを中心に収益を上げる会社です。";

    expect(formatChatAnswerForDisplay(answer)).toBe(answer);
  });

  it("preserves already formatted answers", () => {
    const answer = "売上は増えています。\n\n利益率も改善しています。";

    expect(formatChatAnswerForDisplay(answer)).toBe(answer);
  });
});
