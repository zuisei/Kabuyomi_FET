import {
  AppAttestChallengeRequestSchema,
  AppAttestCompleteRequestSchema,
  InstallationBootstrapRequestSchema
} from "../lib/contracts";
import { isAppError } from "../lib/errors";
import {
  bootstrapInstallationIdentity,
  completeAppAttestation,
  issueAppAttestChallenge,
  resolveInstallationCredential
} from "../lib/installation-identity";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleInstallationIdentityRoutes: RouteHandler = async ({ request, url, env }) => {
  if (request.method !== "POST") return null;
  try {
    if (url.pathname === "/v1/identity/bootstrap") {
      const body = await parseJsonBody(request, InstallationBootstrapRequestSchema, {
        invalidMessage: "Invalid identity bootstrap payload",
        maxBytes: 8_192
      });
      return json(await bootstrapInstallationIdentity(env, request, body));
    }
    if (url.pathname === "/v1/identity/app-attest/challenge") {
      const credential = await resolveInstallationCredential(request, env);
      if (!credential) return json({ error: "Installation credential is required" }, { status: 401 });
      const body = await parseJsonBody(request, AppAttestChallengeRequestSchema, {
        invalidMessage: "Invalid App Attest challenge payload",
        maxBytes: 8_192
      });
      return json(await issueAppAttestChallenge(env, credential, body));
    }
    if (url.pathname === "/v1/identity/app-attest/complete") {
      const credential = await resolveInstallationCredential(request, env);
      if (!credential) return json({ error: "Installation credential is required" }, { status: 401 });
      const body = await parseJsonBody(request, AppAttestCompleteRequestSchema, {
        invalidMessage: "Invalid App Attest completion payload",
        maxBytes: 160_000
      });
      return json({ credential: await completeAppAttestation(env, credential, body) });
    }
    return null;
  } catch (error) {
    if (!isAppError(error)) throw error;
    return json({ error: error.publicMessage }, { status: error.status });
  }
};
