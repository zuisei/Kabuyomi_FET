import { describe, expect, it } from "vitest";
import {
  extractMaterialNumericClaims,
  normalizeNumericWidth
} from "../src/lib/chat/material-numeric-claims";
import { validateNumericAlignment } from "../src/lib/chat/numeric-alignment";

// 全角の数字・％ は日本語の回答にごく自然に現れる。これらが抽出されないと
// `validateNumericAlignment` が `not_applicable` で早期 return し、
// **裏付けの無い数値が一度も検証されないまま回答に載る**。
// 全角カンマ/ピリオドは逆に数値を分断し、正しい値を誤ってブロックする。
describe("full-width numeric claim extraction", () => {
  it("keeps the string length so claim offsets stay valid for the caller's original text", () => {
    const original = "売上高は１，１１１．８億ドル、前年同期比＋16.6％でした。";
    expect(normalizeNumericWidth(original)).toHaveLength(original.length);

    const claim = extractMaterialNumericClaims(original)[0]!;
    expect(original.slice(claim.start, claim.end)).toContain("１");
  });

  it("extracts claims that full-width digits and percent signs used to hide entirely", () => {
    for (const text of [
      "売上高は１１１１.８億ドルでした。",
      "前年同期比+12.1％の増収です。",
      "前年同期比で12.1％増となりました。",
      "売上高は１，１１１．８億ドルでした。"
    ]) {
      expect(extractMaterialNumericClaims(text), text).toHaveLength(1);
    }
  });

  it("no longer splits one figure into two wrong claims on a full-width comma or period", () => {
    for (const text of [
      "売上高は1，111.8億ドルでした。",
      "売上高は1,111．8億ドルでした。",
      "売上高は１，１１１．８億ドルでした。"
    ]) {
      const claims = extractMaterialNumericClaims(text);
      expect(claims, text).toHaveLength(1);
      // 1,111.8億ドル = 111.18B USD。分裂していた頃は 111.8億(1/10)として解決されていた。
      expect(claims[0]!.canonicalValue, text).toBe(111_180_000_000);
    }
  });

  it("no longer lets a full-width answer past verification with zero supporting facts", () => {
    const answer = "売上高は１，１１１．８億ドル、前年同期比＋16.6％でした。";
    const result = validateNumericAlignment({ answer, facts: [], citedSourceIds: [] });

    // 以前は claimCount=0 の not_applicable で素通りしていた。
    expect(result.status).not.toBe("not_applicable");
    expect(result.claimCount).toBeGreaterThan(0);
    expect(result.status).toBe("blocked");
  });
});
