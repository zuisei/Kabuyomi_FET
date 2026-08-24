import type { Env } from "../../env";

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
