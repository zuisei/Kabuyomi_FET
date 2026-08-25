import type { Env } from "../../env";
import { CHAT_CREDIT_COST } from "./usecase";

/// 上位モデル回答の既定単価。標準(2)の2.5倍 — 上位モデルは無料枠が1桁少なく、
/// 超過は従量課金になるため(2026-08-24 オーナー「その分クレジット消費は多くしろ」)。
/// env の PREMIUM_CHAT_CREDIT_COST で調整できる。
export const PREMIUM_CHAT_CREDIT_COST_DEFAULT = 5;

/// サブスクの「クレジット以外の実利」その1: 有料プランは上位モデルで回答する
/// (2026-08-24 オーナー「クレジットだけだと特別感がない」)。
/// OPENAI_CHAT_MODEL_PREMIUM が未設定なら何も変わらない(本番は価格確認まで未設定)。
export interface PremiumModelIdentity {
  plan: string;
  accessMode?: string;
  quotaSubject?: string;
}

export function premiumChatModelEnabled(env: Pick<Env, "OPENAI_CHAT_MODEL_PREMIUM">): boolean {
  return Boolean(env.OPENAI_CHAT_MODEL_PREMIUM?.trim());
}

export function identityUsesPremiumChatModel(identity: PremiumModelIdentity): boolean {
  // ベンチ(テスト自動化)は plan=pro を名乗るが、LKG は標準モデルの品質基準線なので
  // premium には乗せない。premium 側を測る時は実験ごとに基準モデルを差し替える
  // (2026-08-24 luna A/B と同じやり方)。
  if (identity.quotaSubject?.startsWith("pro:test-automation:")) return false;
  return identity.plan !== "free" || identity.accessMode === "dev_unlimited";
}

/// チャット1リクエストぶんの env を返す。上位モデル対象なら OPENAI_CHAT_MODEL を
/// 差し替えたコピー、そうでなければ元の env をそのまま。モデル解決は
/// resolveOpenAIChatModel(env) の1点なので、ここで env を分岐させれば
/// クライアント層(retry・診断・ログの effectiveModelName 含む)全部に効く。
export function chatEnvForIdentity(env: Env, identity: PremiumModelIdentity): Env {
  const premium = env.OPENAI_CHAT_MODEL_PREMIUM?.trim();
  if (!premium || !identityUsesPremiumChatModel(identity)) return env;
  return { ...env, OPENAI_CHAT_MODEL: premium };
}

export function premiumChatCreditCost(env: Pick<Env, "PREMIUM_CHAT_CREDIT_COST">): number {
  const parsed = Number.parseInt(env.PREMIUM_CHAT_CREDIT_COST?.trim() ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : PREMIUM_CHAT_CREDIT_COST_DEFAULT;
}

/// この識別が1問に払うクレジット。上位モデルで答える相手には上位単価、
/// それ以外(無料・ベンチ・premium 未設定)は標準単価。予約・requestHash・
/// 完了時の請求はすべてこの1点を通る。
///
/// **払わない相手には 0 を返す。** dev は `buildChatReservation` が unmetered に
/// するので 1 クレジットも減らないのに、ここが単価を返していたせいで
/// `/v1/usage` が「1問 5 クレジット」と報告し、**端末側の
/// 「残高 >= 単価」判定に引っかかってコンポーザが「残高不足」で塞がっていた**
/// (2026-08-25 実機で発覚: 1問目は通り、2問目が送れない)。
/// 単価が 2 から 5 に上がって境界に当たりやすくなり、表に出た。
export function chatCreditCostForIdentity(env: Env, identity: PremiumModelIdentity): number {
  if (identityPaysNothingPerQuestion(identity)) return 0;
  if (premiumChatModelEnabled(env) && identityUsesPremiumChatModel(identity)) {
    return premiumChatCreditCost(env);
  }
  return CHAT_CREDIT_COST;
}

/// 予約が unmetered になる識別。`buildChatReservation`(routes/chat.ts)と対。
/// **片方だけ変えると、また表示と実際がずれる。**
function identityPaysNothingPerQuestion(identity: PremiumModelIdentity): boolean {
  return identity.accessMode === "dev_unlimited";
}
