import type { Env } from "../env";

export function isAuthorizedInternalRequest(request: Request, env: Env): boolean {
  const configured = env.BACKFILL_SHARED_SECRET?.trim();
  return isAuthorizedSharedSecretRequest(request, configured, "x-internal-token");
}

export function isAuthorizedEvalRequest(request: Request, env: Env): boolean {
  const configured = env.EVAL_SHARED_SECRET?.trim();
  return isAuthorizedSharedSecretRequest(request, configured, "x-eval-token");
}

export function isAuthorizedSecFetcherRequest(request: Request, env: Env): boolean {
  const configured = env.SEC_FETCHER_SHARED_SECRET?.trim();
  return isAuthorizedSharedSecretRequest(request, configured, "x-internal-token");
}

function isAuthorizedSharedSecretRequest(request: Request, configured: string | undefined, headerName: string): boolean {
  if (!configured) {
    return false;
  }

  const supplied = request.headers.get(headerName)?.trim() ?? "";
  return timingSafeEqual(configured, supplied);
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index]! ^ rightBytes[index]!;
  }

  return mismatch === 0;
}
