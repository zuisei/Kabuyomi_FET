import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapInstallationIdentity,
  buildExpectedAppAttestClientDataHash,
  completeAppAttestation,
  issueAppAttestChallenge,
  resolveInstallationCredential,
  setAppAttestVerifierForTests,
  verifyAppAttestAssertionForRequest
} from "../src/lib/installation-identity";
import { readQuotaIdentity } from "../src/lib/quota";

function createEnv() {
  const identities: any[] = [];
  const challenges = new Map<string, any>();
  const limits = new Map<string, number>();
  const principalMigrations = new Map<string, any>();
  const migrationCalls: Array<{ quotaSubject: string; body: Record<string, any> }> = [];
  const db = {
    prepare(sql: string) {
      let args: any[] = [];
      const statement = {
        bind(...values: any[]) { args = values; return statement; },
        async first() {
          if (sql.includes("FROM installation_identities") && sql.includes("WHERE bootstrap_operation_hash = ?")) return identities.find((row) => row.bootstrap_operation_hash === args[0]) ?? null;
          if (sql.includes("FROM installation_identities") && sql.includes("WHERE legacy_device_key_hash = ?")) return identities.find((row) => row.legacy_device_key_hash === args[0]) ?? null;
          if (sql.includes("FROM installation_identities") && sql.includes("WHERE app_attest_key_hash = ?")) return identities.find((row) => row.app_attest_key_hash === args[0]) ?? null;
          if (sql.includes("RETURNING accepted_count")) {
            const key = `${args[0]}|${args[1]}`;
            const count = (limits.get(key) ?? 0) + 1;
            limits.set(key, count);
            return { accepted_count: count };
          }
          if (sql.includes("SELECT app_attest_key_hash") && !sql.includes("legacy_device_key_hash")) {
            const row = identities.find((item) => item.principal === args[0]);
            return row ? { app_attest_key_hash: row.app_attest_key_hash } : null;
          }
          if (sql.includes("FROM installation_identities WHERE principal = ? AND token_reference")) {
            return identities.find((row) => row.principal === args[0] && row.token_reference === args[1]) ?? null;
          }
          if (sql.includes("FROM installation_identities WHERE principal = ?")) {
            return identities.find((row) => row.principal === args[0]) ?? null;
          }
          if (sql.includes("FROM app_attest_challenges")) return challenges.get(args[0]) ?? null;
          if (sql.includes("FROM installation_principal_migrations")) return principalMigrations.get(args[0]) ?? null;
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO installation_identities")) {
            identities.push({
              principal: args[0], token_reference: args[1], token_version: 1,
              attestation_status: args[2], credit_mode: args[3], app_attest_key_hash: args[4],
              network_key: args[5], legacy_device_key_hash: args[6], bootstrap_operation_hash: args[7],
              issued_at: args[8], token_expires_at: args[9], revoked_at: null,
              last_assertion_counter: 0, last_seen_at: args[10]
            });
          } else if (sql.includes("INSERT INTO app_attest_challenges")) {
            challenges.set(args[0], {
              challenge_id: args[0], principal: args[1], token_reference: args[2], purpose: args[3],
              key_id_hash: args[4], expected_client_data_hash: args[6], method: args[7], path: args[8],
              body_sha256: args[9], issued_at: args[10], expires_at: args[11], consumed_at: null
            });
          } else if (sql.includes("SET consumed_at")) {
            const row = challenges.get(args[1]);
            if (!row || row.consumed_at) return { meta: { changes: 0 } };
            row.consumed_at = args[0];
            return { meta: { changes: 1 } };
          } else if (sql.includes("SET attestation_status = 'verified'")) {
            const row = identities.find((item) => item.principal === args[5] && item.token_reference === args[6]);
            if (!row) return { meta: { changes: 0 } };
            row.attestation_status = "verified";
            row.credit_mode = "full";
            row.attested_at = args[0];
            row.token_reference = args[2];
            row.token_version += 1;
            row.issued_at = args[3];
            row.token_expires_at = args[4];
            row.last_assertion_counter = 0;
          } else if (sql.includes("SET token_reference = ?")) {
            const row = identities.find((item) => item.principal === args[8] && item.token_reference === args[9]);
            if (!row || row.revoked_at) return { meta: { changes: 0 } };
            row.token_reference = args[0];
            row.token_version += 1;
            row.issued_at = args[1];
            row.token_expires_at = args[2];
            row.last_seen_at = args[3];
            if (args[4]) {
              row.app_attest_key_hash = args[4];
              row.attestation_status = "pending";
              row.credit_mode = "none";
              row.last_assertion_counter = 0;
            }
          } else if (sql.includes("SET last_assertion_counter = ?")) {
            const row = identities.find((item) => item.principal === args[2] && item.token_reference === args[3]);
            if (!row || row.revoked_at || row.last_assertion_counter >= args[4]) return { meta: { changes: 0 } };
            row.last_assertion_counter = args[0];
            row.last_seen_at = args[1];
          } else if (sql.includes("INSERT INTO installation_principal_migrations")) {
            if (!principalMigrations.has(args[0])) {
              principalMigrations.set(args[0], {
                legacy_device_key_hash: args[0], installation_principal: args[1],
                migration_id: args[2], source_snapshot_digest: "", status: "applying"
              });
            }
          } else if (sql.includes("SET status = 'no_source'")) {
            const row = principalMigrations.get(args[1]);
            if (row) row.status = "no_source";
          } else if (sql.includes("SET source_snapshot_digest = ?")) {
            const row = principalMigrations.get(args[1]);
            if (row) row.source_snapshot_digest = args[0];
          } else if (sql.includes("SET status = 'applied'")) {
            const row = principalMigrations.get(args[1]);
            if (row) row.status = "applied";
          } else if (sql.includes("SET status = 'conflict'")) {
            const row = principalMigrations.get(args[0]);
            if (row) row.status = "conflict";
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  const value = {
    INSTALLATION_TOKEN_HMAC_KEY_V1: "token-secret-for-tests",
    INSTALLATION_NETWORK_HMAC_KEY_V1: "network-secret-for-tests",
    APP_ATTEST_VERIFIER_URL: "https://app-attest-verifier.test/verify",
    APP_ATTEST_VERIFIER_SHARED_SECRET: "app-attest-verifier-secret",
    DB: db,
    KABUYOMI_CACHE: { get: async () => null },
    USER_QUOTA: {
      getByName(quotaSubject: string) {
        return {
          async fetch(request: Request) {
            const body = await request.json() as Record<string, any>;
            migrationCalls.push({ quotaSubject, body });
            if (body.action === "export") {
              const snapshot = {
                version: 1, creditState: null, purchaseRecords: [], monthlyGrantRecords: [],
                creditOperationRecords: [], requestExecutionRecords: [], creditReservationRecords: [],
                exportedAt: "2026-07-11T00:00:00.000Z"
              };
              return Response.json({
                snapshot,
                sourceSnapshotDigest: await sha256Hex(stableJson(snapshot))
              });
            }
            return Response.json({ status: body.action === "apply" ? "applied" : "tombstoned" });
          }
        };
      }
    },
    __principalMigrations: principalMigrations,
    __migrationCalls: migrationCalls,
    __identities: identities,
    __challenges: challenges
  } as any;
  return value;
}

function bootstrapRequest(operation: string, legacy: string, keyId = "app-attest-key-1234567890") {
  return {
    bootstrapOperationId: operation,
    legacyDeviceKey: legacy,
    appAttestCapability: "supported" as const,
    appAttestKeyId: keyId
  };
}

function authRequest(url: string, credential: any, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Installation ${credential.token}`);
  headers.set("x-kabuyomi-installation-principal", credential.principal);
  headers.set("x-kabuyomi-installation-token-reference", credential.tokenReference);
  return new Request(url, { ...init, headers });
}

describe("server installation identity and App Attest", () => {
  afterEach(() => {
    setAppAttestVerifierForTests(undefined);
    vi.useRealTimers();
  });

  it("is idempotent for one installation and rate limits arbitrary fresh identities", async () => {
    const env = createEnv();
    const request = new Request("https://api.test/v1/identity/bootstrap", { headers: { "cf-connecting-ip": "203.0.113.8", "cf-asn": "64500" } });
    const first = await bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-00000001", "legacy-device-key-0001"));
    const retry = await bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-00000001", "legacy-device-key-0001"));
    expect(retry.credential.principal).toBe(first.credential.principal);
    await bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-00000002", "legacy-device-key-0002", "app-attest-key-2234567890"));
    await bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-00000003", "legacy-device-key-0003", "app-attest-key-3234567890"));
    await expect(bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-00000004", "legacy-device-key-0004", "app-attest-key-4234567890")))
      .rejects.toMatchObject({ status: 429 });
  });

  it("rejects arbitrary device-key quota creation when server identity is enabled", async () => {
    const env = createEnv();
    await expect(readQuotaIdentity(new Request("https://api.example/v1/usage", {
      headers: { "x-device-key": "rotated-by-attacker" }
    }), env)).rejects.toMatchObject({ status: 401 });
  });

  it("migrates legacy quota exactly once without duplicating welcome or purchased balances", async () => {
    const env = createEnv();
    const calls: Array<{ quotaSubject: string; body: Record<string, any> }> = [];
    env.USER_QUOTA = {
      getByName(quotaSubject: string) {
        return {
          async fetch(request: Request) {
            const body = await request.json() as Record<string, any>;
            calls.push({ quotaSubject, body });
            if (body.action === "export") {
              const snapshot = {
                version: 1,
                creditState: {
                  plan: "free", periodStart: "2026-07-01", periodEnd: "2026-08-01",
                  monthlyRemaining: 0, monthlyLimit: 0, welcomeRemaining: 17,
                  purchasedRemaining: 25, updatedAt: "2026-07-11T00:00:00.000Z"
                },
                purchaseRecords: [["purchase:tx-1", { transactionId: "tx-1" }]],
                monthlyGrantRecords: [],
                creditOperationRecords: [["credit_operation:purchase:tx-1", { type: "purchase_grant" }]],
                requestExecutionRecords: [],
                creditReservationRecords: [],
                exportedAt: "2026-07-11T00:00:00.000Z"
              };
              return Response.json({ snapshot, sourceSnapshotDigest: await sha256Hex(stableJson(snapshot)) });
            }
            return Response.json({ status: body.action === "apply" ? "applied" : "tombstoned" });
          }
        };
      }
    };
    const request = new Request("https://api.test/v1/identity/bootstrap", {
      headers: { "cf-connecting-ip": "203.0.113.18" }
    });
    const input = bootstrapRequest("operation-legacy-migration", "legacy-device-key-paid");

    const first = await bootstrapInstallationIdentity(env, request, input);
    const retry = await bootstrapInstallationIdentity(env, request, input);

    expect(retry.credential.principal).toBe(first.credential.principal);
    expect(calls.map((call) => call.body.action)).toEqual(["export", "apply", "tombstone"]);
    const applied = calls.find((call) => call.body.action === "apply")!;
    expect(applied.quotaSubject).toBe(first.credential.principal);
    expect(applied.body.snapshot.creditState).toMatchObject({ welcomeRemaining: 17, purchasedRemaining: 25 });
    expect(applied.body.snapshot.purchaseRecords).toHaveLength(1);
  });

  it("verifies attestation once, replaces the pending token, and rejects replay", async () => {
    const env = createEnv();
    const boot = await bootstrapInstallationIdentity(
      env,
      new Request("https://api.test/v1/identity/bootstrap", { headers: { "cf-connecting-ip": "203.0.113.9" } }),
      bootstrapRequest("operation-10000001", "legacy-device-key-1001")
    );
    const pending = await resolveInstallationCredential(authRequest("https://api.test/v1/usage", boot.credential), env);
    expect(pending?.attestationStatus).toBe("pending");
    const challenge = await issueAppAttestChallenge(env, pending!, {
      purpose: "attestation", keyId: "app-attest-key-1234567890",
      installationPrincipal: pending!.principal, tokenReference: pending!.tokenReference
    });
    const clientDataHash = await buildExpectedAppAttestClientDataHash({
      purpose: "attestation", nonce: challenge.nonce, keyId: "app-attest-key-1234567890",
      method: null, path: null, bodySHA256: null,
      installationPrincipal: pending!.principal, tokenReference: pending!.tokenReference
    });
    setAppAttestVerifierForTests(async () => true);
    const verified = await completeAppAttestation(env, pending!, {
      challengeId: challenge.challengeId, keyId: "app-attest-key-1234567890",
      clientDataHash, attestationObject: "verified-attestation-object"
    });
    expect(verified).toMatchObject({ attestationStatus: "verified", creditMode: "full" });
    await expect(completeAppAttestation(env, pending!, {
      challengeId: challenge.challengeId, keyId: "app-attest-key-1234567890",
      clientDataHash, attestationObject: "verified-attestation-object"
    })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects assertion path/body mismatch and consumes the challenge", async () => {
    const env = createEnv();
    const boot = await bootstrapInstallationIdentity(env, new Request("https://api.test", {
      headers: { "cf-connecting-ip": "203.0.113.10" }
    }), bootstrapRequest("operation-20000001", "legacy-device-key-2001"));
    const pending = (await resolveInstallationCredential(authRequest("https://api.test/v1/usage", boot.credential), env))!;
    const attestation = await issueAppAttestChallenge(env, pending, {
      purpose: "attestation", keyId: "app-attest-key-1234567890",
      installationPrincipal: pending.principal, tokenReference: pending.tokenReference
    });
    const attestationHash = await buildExpectedAppAttestClientDataHash({
      purpose: "attestation", nonce: attestation.nonce, keyId: "app-attest-key-1234567890",
      method: null, path: null, bodySHA256: null,
      installationPrincipal: pending.principal, tokenReference: pending.tokenReference
    });
    setAppAttestVerifierForTests(async () => true);
    const verified = await completeAppAttestation(env, pending, {
      challengeId: attestation.challengeId, keyId: "app-attest-key-1234567890", clientDataHash: attestationHash, attestationObject: "object"
    });
    const bodyHash = await sha256Hex("{}");
    const assertionChallenge = await issueAppAttestChallenge(env, verified, {
      purpose: "assertion", keyId: "app-attest-key-1234567890", method: "POST", path: "/v1/chat",
      bodySHA256: bodyHash, installationPrincipal: verified.principal, tokenReference: verified.tokenReference
    });
    const assertionHash = await buildExpectedAppAttestClientDataHash({
      purpose: "assertion", nonce: assertionChallenge.nonce, keyId: "app-attest-key-1234567890",
      method: "POST", path: "/v1/chat", bodySHA256: bodyHash,
      installationPrincipal: verified.principal, tokenReference: verified.tokenReference
    });
    const request = authRequest("https://api.test/v1/translate-quote", verified, {
      method: "POST",
      body: "{}",
      headers: {
        "x-kabuyomi-app-attest-challenge-id": assertionChallenge.challengeId,
        "x-kabuyomi-app-attest-key-id": "app-attest-key-1234567890",
        "x-kabuyomi-app-attest-assertion": "assertion",
        "x-kabuyomi-app-attest-client-data-hash": assertionHash,
        "x-kabuyomi-request-body-sha256": bodyHash
      }
    });
    await expect(verifyAppAttestAssertionForRequest(request, env, verified)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAppAttestAssertionForRequest(request, env, verified)).rejects.toMatchObject({ status: 409 });
  });

  it("binds a bootstrap operation to exactly one legacy key", async () => {
    const env = createEnv();
    const request = new Request("https://api.test/v1/identity/bootstrap", {
      headers: { "cf-connecting-ip": "203.0.113.21" }
    });
    await bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-binding-0001", "legacy-binding-key-0001"));

    await expect(bootstrapInstallationIdentity(
      env, request, bootstrapRequest("operation-binding-0001", "legacy-binding-key-0002")
    )).rejects.toMatchObject({ status: 409 });
    await expect(bootstrapInstallationIdentity(
      env, request, bootstrapRequest("operation-binding-0002", "legacy-binding-key-0001")
    )).rejects.toMatchObject({ status: 409 });
    expect(env.__identities).toHaveLength(1);
  });

  it("upgrades an existing unavailable identity to pending without minting a new principal", async () => {
    const env = createEnv();
    const request = new Request("https://api.test/v1/identity/bootstrap", {
      headers: { "cf-connecting-ip": "203.0.113.22" }
    });
    const unavailable = await bootstrapInstallationIdentity(env, request, {
      bootstrapOperationId: "operation-upgrade-0001",
      legacyDeviceKey: "legacy-upgrade-key-0001",
      appAttestCapability: "unavailable"
    });
    const upgraded = await bootstrapInstallationIdentity(
      env, request, bootstrapRequest("operation-upgrade-0001", "legacy-upgrade-key-0001")
    );

    expect(upgraded.credential).toMatchObject({
      principal: unavailable.credential.principal,
      tokenVersion: 2,
      attestationStatus: "pending",
      creditMode: "none"
    });
    expect(upgraded.credential.tokenReference).not.toBe(unavailable.credential.tokenReference);
    expect(env.__identities).toHaveLength(1);
    expect(env.__migrationCalls.map((call: any) => call.body.action)).toEqual(["export", "unlock"]);
  });

  it("treats client-reported support as unavailable until both verifier settings exist, then re-negotiates once", async () => {
    const env = createEnv();
    delete env.APP_ATTEST_VERIFIER_SHARED_SECRET;
    const request = new Request("https://api.test/v1/identity/bootstrap", {
      headers: { "cf-connecting-ip": "203.0.113.30" }
    });
    const input = bootstrapRequest("operation-config-gate-0001", "legacy-config-gate-0001");

    const unavailable = await bootstrapInstallationIdentity(env, request, input);
    expect(unavailable).toMatchObject({
      attestationRequired: false,
      credential: { attestationStatus: "unavailable", creditMode: "none" }
    });
    expect(env.__identities[0]).toMatchObject({
      app_attest_key_hash: null,
      attestation_status: "unavailable",
      credit_mode: "none"
    });
    await expect(verifyAppAttestAssertionForRequest(
      new Request("https://api.test/v1/admob/reward-intents", { method: "POST", body: "{}" }),
      env,
      unavailable.credential
    )).rejects.toMatchObject({ status: 403, publicMessage: "App Attest verification is required" });

    const retryWhileUnconfigured = await bootstrapInstallationIdentity(env, request, input);
    expect(retryWhileUnconfigured.credential).toMatchObject({
      principal: unavailable.credential.principal,
      tokenReference: unavailable.credential.tokenReference,
      attestationStatus: "unavailable",
      creditMode: "none"
    });

    env.APP_ATTEST_VERIFIER_SHARED_SECRET = "restored-app-attest-secret";
    const upgraded = await bootstrapInstallationIdentity(env, request, input);
    expect(upgraded).toMatchObject({
      attestationRequired: true,
      credential: {
        principal: unavailable.credential.principal,
        attestationStatus: "pending",
        creditMode: "none"
      }
    });
    expect(upgraded.credential.tokenReference).not.toBe(unavailable.credential.tokenReference);

    const pendingRetry = await bootstrapInstallationIdentity(env, request, input);
    expect(pendingRetry.credential.tokenReference).toBe(upgraded.credential.tokenReference);
    expect(env.__identities).toHaveLength(1);
  });

  it("requires both verifier URL and secret before accepting an App Attest key", async () => {
    for (const missing of ["url", "secret"] as const) {
      const env = createEnv();
      if (missing === "url") delete env.APP_ATTEST_VERIFIER_URL;
      else delete env.APP_ATTEST_VERIFIER_SHARED_SECRET;
      const result = await bootstrapInstallationIdentity(
        env,
        new Request("https://api.test/v1/identity/bootstrap", {
          headers: { "cf-connecting-ip": missing === "url" ? "203.0.113.31" : "203.0.113.32" }
        }),
        bootstrapRequest(`operation-partial-${missing}-0001`, `legacy-partial-${missing}-0001`)
      );
      expect(result.credential).toMatchObject({ attestationStatus: "unavailable", creditMode: "none" });
      expect(result.attestationRequired).toBe(false);
      expect(env.__identities[0].app_attest_key_hash).toBeNull();
    }
  });

  it("rejects reuse of one App Attest key across principals", async () => {
    const env = createEnv();
    const request = new Request("https://api.test/v1/identity/bootstrap", {
      headers: { "cf-connecting-ip": "203.0.113.23" }
    });
    await bootstrapInstallationIdentity(env, request, bootstrapRequest("operation-key-owner-01", "legacy-key-owner-0001"));
    await expect(bootstrapInstallationIdentity(
      env, request, bootstrapRequest("operation-key-owner-02", "legacy-key-owner-0002")
    )).rejects.toMatchObject({ status: 409 });
  });

  it("expires bounded credentials and rotates them through the bound bootstrap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const env = createEnv();
    const request = new Request("https://api.test/v1/identity/bootstrap", {
      headers: { "cf-connecting-ip": "203.0.113.24" }
    });
    const first = await bootstrapInstallationIdentity(
      env, request, bootstrapRequest("operation-expiry-0001", "legacy-expiry-key-0001")
    );
    expect(first.credential.expiresAt).toBe("2026-10-09T00:00:00.000Z");

    vi.setSystemTime(new Date("2026-10-10T00:00:00.000Z"));
    await expect(resolveInstallationCredential(authRequest("https://api.test/v1/usage", first.credential), env))
      .rejects.toMatchObject({ status: 401 });
    const rotated = await bootstrapInstallationIdentity(
      env, request, bootstrapRequest("operation-expiry-0001", "legacy-expiry-key-0001")
    );
    expect(rotated.credential.tokenVersion).toBe(2);
    expect(rotated.credential.tokenReference).not.toBe(first.credential.tokenReference);
    await expect(resolveInstallationCredential(authRequest("https://api.test/v1/usage", rotated.credential), env))
      .resolves.toMatchObject({ tokenVersion: 2 });
  });

  it("requires exact nonce binding and a strictly increasing assertion counter", async () => {
    const env = createEnv();
    const boot = await bootstrapInstallationIdentity(env, new Request("https://api.test", {
      headers: { "cf-connecting-ip": "203.0.113.25" }
    }), bootstrapRequest("operation-counter-0001", "legacy-counter-key-0001"));
    const pending = (await resolveInstallationCredential(authRequest("https://api.test/v1/usage", boot.credential), env))!;
    const attestation = await issueAppAttestChallenge(env, pending, {
      purpose: "attestation", keyId: "app-attest-key-1234567890",
      installationPrincipal: pending.principal, tokenReference: pending.tokenReference
    });
    const attestationHash = await buildExpectedAppAttestClientDataHash({
      purpose: "attestation", nonce: attestation.nonce, keyId: "app-attest-key-1234567890",
      method: null, path: null, bodySHA256: null,
      installationPrincipal: pending.principal, tokenReference: pending.tokenReference
    });
    setAppAttestVerifierForTests(async () => true);
    const verified = await completeAppAttestation(env, pending, {
      challengeId: attestation.challengeId,
      keyId: "app-attest-key-1234567890",
      clientDataHash: attestationHash,
      attestationObject: "attestation"
    });

    const bodyHash = await sha256Hex("{}");
    const nonceBoundChallenge = await issueAppAttestChallenge(env, verified, {
      purpose: "assertion", keyId: "app-attest-key-1234567890", method: "POST", path: "/v1/chat",
      bodySHA256: bodyHash, installationPrincipal: verified.principal, tokenReference: verified.tokenReference
    });
    let verifierCalls = 0;
    setAppAttestVerifierForTests(async () => {
      verifierCalls += 1;
      return { verified: true, assertionCounter: 1 };
    });
    await expect(verifyAppAttestAssertionForRequest(authRequest("https://api.test/v1/chat", verified, {
      method: "POST",
      body: "{}",
      headers: {
        "x-kabuyomi-app-attest-challenge-id": nonceBoundChallenge.challengeId,
        "x-kabuyomi-app-attest-key-id": "app-attest-key-1234567890",
        "x-kabuyomi-app-attest-assertion": "captured-assertion",
        "x-kabuyomi-app-attest-client-data-hash": attestationHash,
        "x-kabuyomi-request-body-sha256": bodyHash
      }
    }), env, verified)).rejects.toMatchObject({ status: 403 });
    expect(verifierCalls).toBe(0);

    const assertOnce = async (counter?: number) => {
      const challenge = await issueAppAttestChallenge(env, verified, {
        purpose: "assertion", keyId: "app-attest-key-1234567890", method: "POST", path: "/v1/chat",
        bodySHA256: bodyHash, installationPrincipal: verified.principal, tokenReference: verified.tokenReference
      });
      const hash = await buildExpectedAppAttestClientDataHash({
        purpose: "assertion", nonce: challenge.nonce, keyId: "app-attest-key-1234567890",
        method: "POST", path: "/v1/chat", bodySHA256: bodyHash,
        installationPrincipal: verified.principal, tokenReference: verified.tokenReference
      });
      setAppAttestVerifierForTests(async () => ({
        verified: true,
        ...(counter === undefined ? {} : { assertionCounter: counter })
      }));
      return verifyAppAttestAssertionForRequest(authRequest("https://api.test/v1/chat", verified, {
        method: "POST",
        body: "{}",
        headers: {
          "x-kabuyomi-app-attest-challenge-id": challenge.challengeId,
          "x-kabuyomi-app-attest-key-id": "app-attest-key-1234567890",
          "x-kabuyomi-app-attest-assertion": "captured-assertion",
          "x-kabuyomi-app-attest-client-data-hash": hash,
          "x-kabuyomi-request-body-sha256": bodyHash
        }
      }), env, verified);
    };

    await expect(assertOnce()).rejects.toMatchObject({ status: 503 });
    await expect(assertOnce(1)).resolves.toBeUndefined();
    await expect(assertOnce(1)).rejects.toMatchObject({ status: 409 });
    await expect(assertOnce(2)).resolves.toBeUndefined();
    expect(env.__identities[0].last_assertion_counter).toBe(2);
  });
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
