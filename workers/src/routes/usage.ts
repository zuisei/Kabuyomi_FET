import { loadUsage, readQuotaIdentity } from "../lib/quota";
import { isCreditBillingEnabledForIdentity } from "../lib/remote-config";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleUsageRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "GET" && url.pathname === "/v1/usage")) {
    return null;
  }

  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const usage = await loadUsage(identity, env, config);
  return json({ ...usage, creditBillingEnabled: isCreditBillingEnabledForIdentity(config, identity) });
};
