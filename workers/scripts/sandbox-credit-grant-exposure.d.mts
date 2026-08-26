// `sandbox-credit-grant-exposure.mjs` は wrangler を spawn するため素の ESM のまま置く。
// TypeScript のテストから読むには宣言が要る(無いと TS7016 で typecheck が落ちる)。
export function buildSandboxGrantExposureQuery(): string;

export function buildUnknownEnvironmentTransactionQuery(limit?: number | string): string;

export function reportLimitations(): string;
