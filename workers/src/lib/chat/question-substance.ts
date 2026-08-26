/**
 * 「h」「G」のような1文字の入力にも、回答生成が走ってクレジットが消費され、
 * もっともらしい文(「最も強い根拠は、各指標が四半期ベースで公表されている点です」)が
 * 返っていた(2026-08-22 実機レビュー)。意味を持ちえない入力は予約の前で止める。
 *
 * 基準は「内容文字(文字・数字)が2つ以上」だけ。「売上」「AWS」「ok」は通り、
 * 1文字や記号だけの入力は止まる。意図の有無を推定する試みはしない —
 * それは回答側の仕事で、ここは課金の前段にある門。
 */
export function questionHasSubstance(question: string): boolean {
  const contentCharacters = question.match(/[\p{L}\p{N}]/gu) ?? [];
  return contentCharacters.length >= 2;
}

export const QUESTION_TOO_SHORT_MESSAGE = "質問が短すぎます。何について知りたいか、もう少し書いてください。";
