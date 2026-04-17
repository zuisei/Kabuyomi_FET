import { logEvent } from "../lib/logging";
import { unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleBillingSyncRoute: RouteHandler = async ({ request, url }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/billing/sync")) {
    return null;
  }

  logEvent("billing_sync_blocked", {
    path: url.pathname,
    mode: "beta_disabled"
  });

  return unavailable("Billing sync is disabled during beta");
};
