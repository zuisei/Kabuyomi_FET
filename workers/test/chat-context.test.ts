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

  it("keeps structural-change follow-ups as durability questions", () => {
    const marginContext = [
      { role: "user" as const, content: "利益率が改善、または悪化した理由は？" },
      {
        role: "assistant" as const,
        content: "営業利益率は 20.2% から 16.5% へ低下しています。"
      }
    ];

    expect(resolveContextualQuestion("これは一時要因？それとも構造的な変化？", marginContext)).toBe(
      "利益率が変化した要因は一時的ですか？"
    );
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

    expect(resolveContextualQuestion("その要因は一時的？", revenueContext)).toBe(
      "前問では売上高の具体的なdriverが十分に特定できていません。売上高の一時要因と継続要因を、確認できる範囲と不明点に分けて説明してください。"
    );
  });

  it("injects extracted driver candidates into durability follow-ups", () => {
    const retailContext = [
      { role: "user" as const, content: "売上成長の要因は？" },
      {
        role: "assistant" as const,
        content:
          "売上は増加しました。主な要因として、既存店売上、traffic、eCommerce、membership income が寄与しています。"
      }
    ];

    expect(resolveContextualQuestion("その要因は一時的？", retailContext)).toBe(
      "前問で挙げた売上高の要因（既存店売上、traffic、eCommerce、membership）は一時的ですか？継続性と不明点を分けて説明してください。"
    );
  });

  it("extracts Japanese driver labels from supported Q03 answers", () => {
    const industrialContext = [
      { role: "user" as const, content: "売上成長の要因は？" },
      {
        role: "assistant" as const,
        content:
          "本文の要因: 売上増加は主に販売量の増加による。価格実現が不利だったため一部相殺されました。機械をエンドユーザーへ多く販売したことが主因です。"
      }
    ];

    expect(resolveContextualQuestion("その要因は一時的？", industrialContext)).toBe(
      "前問で挙げた売上高の要因（pricing、volume）は一時的ですか？継続性と不明点を分けて説明してください。"
    );
  });

  it("marks durability follow-ups unresolved when the previous answer did not identify a driver", () => {
    const unresolvedRevenueContext = [
      { role: "user" as const, content: "売上成長の要因は？" },
      {
        role: "assistant" as const,
        content:
          "売上高は 7,131.6億ドル で、前年同期比 4.7%増です。選ばれた Item 7 の範囲では、価格・数量・地域・セグメントのどれが主因かまでは薄めです。小売では、既存店売上、traffic、ticket、eCommerce、membership、在庫とgross marginを確認する必要があります。"
      }
    ];

    expect(resolveContextualQuestion("その要因は一時的？", unresolvedRevenueContext)).toBe(
      "前問では売上高の具体的なdriverが十分に特定できていません。売上高の一時要因と継続要因を、確認できる範囲と不明点に分けて説明してください。"
    );
  });
});
