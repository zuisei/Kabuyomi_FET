import { execFileSync } from "node:child_process";

const keychainAccount = process.env.MD_KEYCHAIN_ACCOUNT ?? "0xt4";

function keychainPassword(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", keychainAccount, "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return undefined;
  }
}

export function accessHeaders(): Record<string, string> {
  const environment = process.env.MD_ENVIRONMENT?.toLowerCase();
  const prefix = environment === "production"
    ? "MarketDocketProduction"
    : environment === "testflight" ? "MarketDocketTestFlight" : "MarketDocketPreview";
  const clientID = process.env.MD_ACCESS_CLIENT_ID
    ?? keychainPassword(`${prefix}AccessClientID`);
  const clientSecret = process.env.MD_ACCESS_CLIENT_SECRET
    ?? keychainPassword(`${prefix}AccessClientSecret`);

  if (!clientID && !clientSecret) return {};
  if (!clientID || !clientSecret) {
    throw new Error("Cloudflare Access requires both client ID and client secret");
  }
  return {
    "CF-Access-Client-Id": clientID,
    "CF-Access-Client-Secret": clientSecret
  };
}
