import type { Env } from "../env";

export function isAuthorizedInternalRequest(request: Request, env: Env): boolean {
  const configured = env.BACKFILL_SHARED_SECRET?.trim();
  if (!configured) {
    return false;
  }

  const supplied = request.headers.get("x-internal-token")?.trim() ?? "";
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
