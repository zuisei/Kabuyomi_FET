// `deploy-worker.mjs` は wrangler から直接実行する必要があるため素の ESM のまま置く。
// TypeScript のテストから読むには宣言が要る(無いと TS7016 で typecheck が落ちる)。
export function assertAppAttestBundleVersionCovered(
  allowlist: string | undefined,
  iosBuildNumber: string | undefined
): void;

export function parseDeployRequest(args: string[]): {
  target: "test" | "production";
  dryRun: boolean;
  checkOnly: boolean;
};

export function buildWranglerDeployArgs(request: {
  target: "test" | "production";
  dryRun?: boolean;
  releaseCandidateId: string;
}): string[];

export function prepareDeploy(
  request: { target: "test" | "production"; dryRun?: boolean; checkOnly?: boolean },
  options?: Record<string, unknown>
): Promise<unknown>;
