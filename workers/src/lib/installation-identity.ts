import type { Env } from "../env";
import { AppError } from "./errors";
import { hashForLog, logEvent, logWarnEvent } from "./logging";
import {
  isBuiltInAppAttestVerifierConfigured,
  verifyBuiltInAssertion,
  verifyBuiltInAttestation
} from "./app-attest-verifier";

export type InstallationAttestationStatus = "pending" | "verified" | "unavailable";
export type InstallationCreditMode = "full" | "reduced" | "none";

export interface InstallationCredential {
  token: string;
  principal: string;
  tokenReference: string;
  tokenVersion: number;
  issuedAt: string;
  expiresAt?: string;
  attestationStatus: InstallationAttestationStatus;
  creditMode: InstallationCreditMode;
}

interface InstallationTokenPayload {
  v: 1;
  p: string;
  r: string;
  iat: string;
  tv?: number;
  exp?: number;
  att: InstallationAttestationStatus;
  cm: InstallationCreditMode;
}

interface InstallationIdentityRow {
  principal: string;
  token_reference: string;
  token_version: number;
  attestation_status: InstallationAttestationStatus;
  credit_mode: InstallationCreditMode;
  app_attest_key_hash: string | null;
  legacy_device_key_hash?: string | null;
  bootstrap_operation_hash?: string;
  issued_at: string;
  token_expires_at?: string | null;
  revoked_at?: string | null;
  last_assertion_counter?: number;
  app_attest_public_key_spki?: ArrayBuffer | Uint8Array | null;
  app_attest_environment?: string | null;
}

interface AppAttestChallengeRow {
  challenge_id: string;
  principal: string;
  token_reference: string;
  purpose: "attestation" | "assertion";
  key_id_hash: string;
  expected_client_data_hash: string | null;
  method: string | null;
  path: string | null;
  body_sha256: string | null;
  expires_at: string;
  consumed_at: string | null;
}

type AppAttestVerificationKind = "attestation" | "assertion";
type AppAttestVerifier = (input: {
  kind: AppAttestVerificationKind;
  keyId: string;
  clientDataHash: string;
  artifact: string;
  principal: string;
}) => Promise<boolean | {
  verified: boolean;
  assertionCounter?: number;
  publicKeySpki?: Uint8Array;
  environment?: "development" | "production";
}>;

interface AppAttestVerificationResult {
  verified: boolean;
  assertionCounter?: number;
  publicKeySpki?: Uint8Array;
  environment?: "development" | "production";
}

const INSTALLATION_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const INSTALLATION_CREDENTIAL_ROTATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;

let testVerifier: AppAttestVerifier | undefined;

export function setAppAttestVerifierForTests(verifier?: AppAttestVerifier): void {
  testVerifier = verifier;
}

export function isAppAttestVerificationConfigured(env: Env): boolean {
  return isBuiltInAppAttestVerifierConfigured(env) || Boolean(
    env.APP_ATTEST_VERIFIER_URL?.trim() &&
    env.APP_ATTEST_VERIFIER_SHARED_SECRET?.trim()
  );
}

export async function bootstrapInstallationIdentity(env: Env, request: Request, input: {
  bootstrapOperationId: string;
  legacyDeviceKey: string;
  appAttestCapability: "supported" | "unavailable";
  appAttestKeyId?: string | null;
}): Promise<{ credential: InstallationCredential; attestationRequired: boolean }> {
  requireIdentityConfiguration(env);
  const operationHash = await hmacHex(env.INSTALLATION_NETWORK_HMAC_KEY_V1!, `bootstrap-operation\0${input.bootstrapOperationId}`);
  const legacyHash = await hmacHex(env.INSTALLATION_NETWORK_HMAC_KEY_V1!, `legacy-device\0${input.legacyDeviceKey}`);
  // Client capability is not authority for enabling App Attest. If the server
  // verifier is incomplete, issue the documented unsupported path instead of
  // trapping the installation in a pending state it can never complete.
  const requestedKeyId = isAppAttestVerificationConfigured(env) && input.appAttestCapability === "supported"
    ? input.appAttestKeyId?.trim() || null
    : null;
  const requestedKeyHash = requestedKeyId
    ? await hmacHex(env.INSTALLATION_NETWORK_HMAC_KEY_V1!, `app-attest-key\0${requestedKeyId}`)
    : null;
  const existing = await findStrictBootstrapIdentity(env.DB, operationHash, legacyHash);
  if (existing) {
    if (existing.revoked_at) {
      throw new AppError(403, "Installation identity has been revoked");
    }
    const refreshed = await refreshExistingBootstrapIdentity(env, existing, requestedKeyHash);
    await ensureLegacyQuotaMigration(env, input.legacyDeviceKey, legacyHash, existing.principal);
    return {
      credential: await credentialFromRow(env, refreshed),
      attestationRequired: refreshed.attestation_status === "pending"
    };
  }

  if (requestedKeyHash) {
    const keyOwner = await findIdentityByAppAttestKeyHash(env.DB, requestedKeyHash);
    if (keyOwner) throw new AppError(409, "App Attest key is already registered");
  }

  const networkKey = await buildNetworkRouteKey(env, request, "identity_bootstrap");
  const acceptedCount = await incrementBootstrapWindow(env.DB, networkKey);
  if (acceptedCount > 3) {
    logWarnEvent("installation_bootstrap_rejected", {
      networkKey,
      reason: "network_rate_limit"
    });
    throw new AppError(429, "Identity bootstrap rate limit exceeded");
  }

  const hasAttestKey = Boolean(requestedKeyHash);
  const attestationStatus: InstallationAttestationStatus = hasAttestKey ? "pending" : "unavailable";
  const creditMode: InstallationCreditMode = "none";
  const issuedAt = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.parse(issuedAt) + INSTALLATION_CREDENTIAL_TTL_MS).toISOString();
  const principalDigest = await hmacBytes(
    env.INSTALLATION_TOKEN_HMAC_KEY_V1!,
    `installation-principal-v1\0${operationHash}\0${legacyHash}\0${requestedKeyId ?? "unavailable"}`
  );
  const principal = `installation:v1:${base64Url(principalDigest)}`;
  const tokenReference = `itok_${base64Url(crypto.getRandomValues(new Uint8Array(18)))}`;
  const appAttestKeyHash = requestedKeyHash;

  try {
    await env.DB.prepare(
      `INSERT INTO installation_identities (
        principal, token_reference, token_version, attestation_status, credit_mode,
        app_attest_key_hash, network_key, legacy_device_key_hash, bootstrap_operation_hash,
        issued_at, token_expires_at, revoked_at, last_assertion_counter, last_seen_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
    ).bind(
      principal, tokenReference, attestationStatus, creditMode, appAttestKeyHash,
      networkKey, legacyHash, operationHash, issuedAt, tokenExpiresAt, issuedAt
    ).run();
  } catch {
    const raced = await findStrictBootstrapIdentity(env.DB, operationHash, legacyHash);
    if (!raced) {
      if (requestedKeyHash && await findIdentityByAppAttestKeyHash(env.DB, requestedKeyHash)) {
        throw new AppError(409, "App Attest key is already registered");
      }
      throw new AppError(503, "Identity bootstrap is temporarily unavailable");
    }
    await ensureLegacyQuotaMigration(env, input.legacyDeviceKey, legacyHash, raced.principal);
    const refreshed = await refreshExistingBootstrapIdentity(env, raced, requestedKeyHash);
    return { credential: await credentialFromRow(env, refreshed), attestationRequired: refreshed.attestation_status === "pending" };
  }

  const row: InstallationIdentityRow = {
    principal,
    token_reference: tokenReference,
    token_version: 1,
    attestation_status: attestationStatus,
    credit_mode: creditMode,
    app_attest_key_hash: appAttestKeyHash,
    legacy_device_key_hash: legacyHash,
    bootstrap_operation_hash: operationHash,
    issued_at: issuedAt,
    token_expires_at: tokenExpiresAt,
    revoked_at: null,
    last_assertion_counter: 0
  };
  logEvent("installation_bootstrap_accepted", {
    principalHash: hashForLog(principal),
    networkKey,
    attestationStatus,
    creditMode,
    freshIdentityCount: acceptedCount
  });
  await ensureLegacyQuotaMigration(env, input.legacyDeviceKey, legacyHash, principal);
  return { credential: await credentialFromRow(env, row), attestationRequired: attestationStatus === "pending" };
}

async function ensureLegacyQuotaMigration(
  env: Env,
  legacyDeviceKey: string,
  legacyHash: string,
  installationPrincipal: string
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT installation_principal, status FROM installation_principal_migrations
     WHERE legacy_device_key_hash = ?`
  ).bind(legacyHash).first<{ installation_principal: string; status: string }>();
  if (existing) {
    if (existing.installation_principal !== installationPrincipal) {
      throw new AppError(409, "Legacy installation migration conflict");
    }
    if (existing.status === "applied" || existing.status === "no_source") return;
    if (existing.status === "conflict") throw new AppError(409, "Legacy installation migration requires review");
  }

  const migrationId = `installation_legacy_v1_${legacyHash}`;
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO installation_principal_migrations (
      legacy_device_key_hash, installation_principal, migration_id,
      source_snapshot_digest, status, created_at
    ) VALUES (?, ?, ?, '', 'applying', ?)
    ON CONFLICT(legacy_device_key_hash) DO NOTHING`
  ).bind(legacyHash, installationPrincipal, migrationId, createdAt).run();

  const sourceQuotaSubject = `free:device:${await sha256Hex(`free-device:${legacyDeviceKey}`)}`;
  const exported = await callPrincipalMigration(env, sourceQuotaSubject, {
    action: "export",
    migrationId
  });
  if (exported.status === "already_tombstoned") {
    const tombstone = exported.tombstone as { migrationId?: unknown; targetPrincipal?: unknown } | undefined;
    if (tombstone?.migrationId !== migrationId || tombstone.targetPrincipal !== installationPrincipal) {
      throw new AppError(409, "Legacy installation migration tombstone conflict");
    }
    await rebindPurchaseTransactionOwners(env.DB, sourceQuotaSubject, installationPrincipal);
    await env.DB.prepare(
      `UPDATE installation_principal_migrations
       SET status = 'applied', applied_at = ?, conflict_reason = NULL
       WHERE legacy_device_key_hash = ? AND installation_principal = ?`
    ).bind(new Date().toISOString(), legacyHash, installationPrincipal).run();
    return;
  }
  const exportedSourceSnapshotDigest = String(exported.sourceSnapshotDigest ?? "");
  const sourceSnapshot = exported.snapshot as {
    version?: number;
    creditState?: unknown;
    purchaseRecords?: unknown[];
    monthlyGrantRecords?: unknown[];
    creditOperationRecords?: unknown[];
    requestExecutionRecords?: unknown[];
    creditReservationRecords?: unknown[];
  } | undefined;
  if (!sourceSnapshot || sourceSnapshot.version !== 1) {
    await unlockPrincipalMigrationSafely(env, sourceQuotaSubject, migrationId, exportedSourceSnapshotDigest);
    throw new AppError(503, "Legacy installation migration export failed");
  }

  const hasState = Boolean(sourceSnapshot.creditState)
    || (sourceSnapshot.purchaseRecords?.length ?? 0) > 0
    || (sourceSnapshot.monthlyGrantRecords?.length ?? 0) > 0
    || (sourceSnapshot.creditOperationRecords?.length ?? 0) > 0
    || (sourceSnapshot.requestExecutionRecords?.length ?? 0) > 0
    || (sourceSnapshot.creditReservationRecords?.length ?? 0) > 0;
  if (!hasState) {
    await callPrincipalMigration(env, sourceQuotaSubject, {
      action: "unlock",
      migrationId,
      sourceSnapshotDigest: exportedSourceSnapshotDigest
    });
    await env.DB.prepare(
      `UPDATE installation_principal_migrations
       SET status = 'no_source', applied_at = ?
       WHERE legacy_device_key_hash = ? AND installation_principal = ?`
    ).bind(new Date().toISOString(), legacyHash, installationPrincipal).run();
    return;
  }

  const sourceSnapshotDigest = exportedSourceSnapshotDigest;
  if (!/^[a-f0-9]{64}$/u.test(sourceSnapshotDigest) ||
      await sha256Hex(stableJson(sourceSnapshot)) !== sourceSnapshotDigest) {
    await unlockPrincipalMigrationSafely(env, sourceQuotaSubject, migrationId, sourceSnapshotDigest);
    throw new AppError(503, "Legacy installation migration digest verification failed");
  }
  const sourceQuotaSubjectHash = await sha256Hex(`installation-legacy-source:${sourceQuotaSubject}`);
  try {
    await env.DB.prepare(
      `UPDATE installation_principal_migrations SET source_snapshot_digest = ?
       WHERE legacy_device_key_hash = ? AND installation_principal = ?`
    ).bind(sourceSnapshotDigest, legacyHash, installationPrincipal).run();
  } catch (error) {
    await unlockPrincipalMigrationSafely(env, sourceQuotaSubject, migrationId, sourceSnapshotDigest);
    throw error;
  }

  let targetApplied = false;
  try {
    await callPrincipalMigration(env, installationPrincipal, {
      action: "apply",
      migrationId,
      sourceQuotaSubjectHash,
      sourceSnapshotDigest,
      snapshot: sourceSnapshot
    });
    targetApplied = true;
    await callPrincipalMigration(env, sourceQuotaSubject, {
      action: "tombstone",
      migrationId,
      targetPrincipal: installationPrincipal,
      sourceSnapshotDigest
    });
    await rebindPurchaseTransactionOwners(env.DB, sourceQuotaSubject, installationPrincipal);
  } catch (error) {
    if (!targetApplied) {
      await unlockPrincipalMigrationSafely(env, sourceQuotaSubject, migrationId, sourceSnapshotDigest);
    }
    if (error instanceof AppError && error.status === 409) {
      await env.DB.prepare(
        `UPDATE installation_principal_migrations
         SET status = 'conflict', conflict_reason = 'target_state_conflict'
         WHERE legacy_device_key_hash = ? AND installation_principal = ?`
      ).bind(legacyHash, installationPrincipal).run();
    }
    throw error;
  }

  await env.DB.prepare(
    `UPDATE installation_principal_migrations
     SET status = 'applied', applied_at = ?, conflict_reason = NULL
     WHERE legacy_device_key_hash = ? AND installation_principal = ?`
  ).bind(new Date().toISOString(), legacyHash, installationPrincipal).run();
  logEvent("installation_legacy_quota_migrated", {
    installationPrincipalHash: hashForLog(installationPrincipal),
    legacyDeviceKeyHash: legacyHash,
    sourceSnapshotDigest
  });
}

async function rebindPurchaseTransactionOwners(
  db: D1Database,
  sourceQuotaSubject: string,
  targetQuotaSubject: string
): Promise<void> {
  await db.prepare(
    `UPDATE purchase_transactions
     SET user_id = ?, updated_at = ?
     WHERE user_id = ?`
  ).bind(targetQuotaSubject, new Date().toISOString(), sourceQuotaSubject).run();
}

async function unlockPrincipalMigrationSafely(
  env: Env,
  quotaSubject: string,
  migrationId: string,
  sourceSnapshotDigest: string
): Promise<void> {
  try {
    await callPrincipalMigration(env, quotaSubject, {
      action: "unlock",
      migrationId,
      sourceSnapshotDigest
    });
  } catch (error) {
    logWarnEvent("principal_migration_unlock_failed", {
      migrationIdHash: hashForLog(migrationId),
      quotaSubjectHash: hashForLog(quotaSubject),
      errorClass: error instanceof Error ? error.name : typeof error
    });
  }
}

async function callPrincipalMigration(env: Env, quotaSubject: string, body: Record<string, unknown>) {
  const response = await env.USER_QUOTA.getByName(quotaSubject).fetch(
    new Request("https://quota.internal/principal-migration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new AppError(response.status, String(payload.error ?? "Legacy installation migration failed"));
  return payload;
}

export async function resolveInstallationCredential(request: Request, env: Env): Promise<InstallationCredential | null> {
  const header = request.headers.get("authorization")?.trim();
  if (!header?.startsWith("Installation ")) return null;
  requireIdentityConfiguration(env);
  const token = header.slice("Installation ".length).trim();
  const payload = await verifyToken(env, token);
  const headerPrincipal = request.headers.get("x-kabuyomi-installation-principal")?.trim();
  const headerReference = request.headers.get("x-kabuyomi-installation-token-reference")?.trim();
  if (headerPrincipal !== payload.p || headerReference !== payload.r) {
    throw new AppError(401, "Installation credential mismatch");
  }
  const row = await env.DB.prepare(
    `SELECT principal, token_reference, token_version, attestation_status, credit_mode,
            app_attest_key_hash, legacy_device_key_hash, bootstrap_operation_hash,
            issued_at, token_expires_at, revoked_at, last_assertion_counter,
            app_attest_public_key_spki, app_attest_environment
     FROM installation_identities WHERE principal = ? AND token_reference = ?`
  ).bind(payload.p, payload.r).first<InstallationIdentityRow>();
  if (!row) throw new AppError(401, "Installation credential is not recognized");
  if (row.revoked_at) throw new AppError(401, "Installation credential has been revoked");
  const tokenVersion = payload.tv ?? 1;
  if (row.token_version !== tokenVersion) throw new AppError(401, "Installation credential has been replaced");
  const expiresAtMs = Date.parse(resolveTokenExpiry(row));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new AppError(401, "Installation credential has expired");
  }
  if (payload.exp !== undefined && payload.exp !== Math.floor(expiresAtMs / 1_000)) {
    throw new AppError(401, "Installation credential expiry mismatch");
  }
  if (row.attestation_status !== payload.att || row.credit_mode !== payload.cm) {
    // A pending token is intentionally replaced after attestation and cannot
    // be used as an assertion credential.
    throw new AppError(401, "Installation credential has been replaced");
  }
  if (row.attestation_status === "verified" && isBuiltInAppAttestVerifierConfigured(env)
      && !hasCurrentBuiltInVerificationMaterial(env, row)) {
    throw new AppError(401, "Installation credential requires App Attest rebootstrap");
  }
  return { token, principal: row.principal, tokenReference: row.token_reference, tokenVersion: row.token_version,
    issuedAt: row.issued_at, expiresAt: resolveTokenExpiry(row),
    attestationStatus: row.attestation_status, creditMode: row.credit_mode };
}

export async function issueAppAttestChallenge(env: Env, credential: InstallationCredential, input: {
  purpose: "attestation" | "assertion";
  keyId: string;
  method?: string | null;
  path?: string | null;
  bodySHA256?: string | null;
  installationPrincipal: string;
  tokenReference: string;
}): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
  if (credential.principal !== input.installationPrincipal || credential.tokenReference !== input.tokenReference) {
    throw new AppError(401, "Installation credential mismatch");
  }
  if (input.purpose === "assertion" && credential.attestationStatus !== "verified") {
    throw new AppError(403, "App Attest verification is required");
  }
  const keyHash = await hmacHex(env.INSTALLATION_NETWORK_HMAC_KEY_V1!, `app-attest-key\0${input.keyId}`);
  const identity = await env.DB.prepare(
    "SELECT app_attest_key_hash FROM installation_identities WHERE principal = ?"
  ).bind(credential.principal).first<{ app_attest_key_hash: string | null }>();
  if (!identity?.app_attest_key_hash || identity.app_attest_key_hash !== keyHash) {
    throw new AppError(403, "App Attest key mismatch");
  }
  const challengeId = crypto.randomUUID();
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const method = input.method?.toUpperCase() ?? null;
  const path = input.path ?? null;
  const bodySHA256 = input.bodySHA256 ?? null;
  const expectedClientDataHash = await buildExpectedAppAttestClientDataHash({
    purpose: input.purpose,
    nonce,
    keyId: input.keyId,
    method,
    path,
    bodySHA256,
    installationPrincipal: credential.principal,
    tokenReference: credential.tokenReference
  });
  await env.DB.prepare(
    `INSERT INTO app_attest_challenges (
      challenge_id, principal, token_reference, purpose, key_id_hash, nonce_digest,
      expected_client_data_hash, method, path, body_sha256, issued_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    challengeId, credential.principal, credential.tokenReference, input.purpose, keyHash,
    await sha256Hex(nonce), expectedClientDataHash, method, path,
    bodySHA256, now.toISOString(), expiresAt
  ).run();
  return { challengeId, nonce, expiresAt };
}

export async function completeAppAttestation(env: Env, credential: InstallationCredential, input: {
  challengeId: string; keyId: string; clientDataHash: string; attestationObject: string;
}): Promise<InstallationCredential> {
  const challenge = await claimChallenge(env, credential, input.challengeId, "attestation", input.keyId);
  if (!challenge.expected_client_data_hash || !timingSafeEqual(challenge.expected_client_data_hash, input.clientDataHash)) {
    await markChallengeResult(env.DB, challenge.challenge_id, "binding_mismatch");
    throw new AppError(403, "App Attest challenge binding mismatch");
  }
  const verification = await verifyWithConfiguredService(env, {
    kind: "attestation",
    keyId: input.keyId,
    clientDataHash: input.clientDataHash,
    artifact: input.attestationObject,
    principal: credential.principal
  });
  if (!verification.verified) {
    await markChallengeResult(env.DB, challenge.challenge_id, "rejected");
    throw new AppError(403, "App Attest verification failed");
  }
  const attestedAt = new Date().toISOString();
  const tokenReference = `itok_${base64Url(crypto.getRandomValues(new Uint8Array(18)))}`;
  const tokenExpiresAt = new Date(Date.parse(attestedAt) + INSTALLATION_CREDENTIAL_TTL_MS).toISOString();
  const update = await env.DB.prepare(
    `UPDATE installation_identities
     SET attestation_status = 'verified', credit_mode = 'full', attested_at = ?, last_seen_at = ?,
         token_reference = ?, token_version = token_version + 1, issued_at = ?, token_expires_at = ?,
         revoked_at = NULL, last_assertion_counter = 0,
         app_attest_public_key_spki = COALESCE(?, app_attest_public_key_spki),
         app_attest_environment = COALESCE(?, app_attest_environment)
     WHERE principal = ? AND token_reference = ?`
  ).bind(attestedAt, attestedAt, tokenReference, attestedAt, tokenExpiresAt,
    verification.publicKeySpki ?? null, verification.environment ?? null,
    credential.principal, credential.tokenReference).run();
  if (Number(update.meta?.changes ?? 0) !== 1) throw new AppError(409, "Installation credential was replaced");
  await markChallengeResult(env.DB, challenge.challenge_id, "verified");
  const row = await env.DB.prepare(
    `SELECT principal, token_reference, token_version, attestation_status, credit_mode,
            app_attest_key_hash, legacy_device_key_hash, bootstrap_operation_hash,
            issued_at, token_expires_at, revoked_at, last_assertion_counter,
            app_attest_public_key_spki, app_attest_environment
     FROM installation_identities WHERE principal = ?`
  ).bind(credential.principal).first<InstallationIdentityRow>();
  if (!row) throw new AppError(503, "Installation identity update failed");
  logEvent("app_attest_attestation_verified", { principalHash: hashForLog(credential.principal) });
  return credentialFromRow(env, row);
}

export async function verifyAppAttestAssertionForRequest(request: Request, env: Env, credential: InstallationCredential): Promise<void> {
  if (credential.attestationStatus !== "verified") {
    throw new AppError(403, "App Attest verification is required");
  }
  const challengeId = request.headers.get("x-kabuyomi-app-attest-challenge-id")?.trim();
  const keyId = request.headers.get("x-kabuyomi-app-attest-key-id")?.trim();
  const assertion = request.headers.get("x-kabuyomi-app-attest-assertion")?.trim();
  const clientDataHash = request.headers.get("x-kabuyomi-app-attest-client-data-hash")?.trim();
  const bodySHA256 = request.headers.get("x-kabuyomi-request-body-sha256")?.trim();
  if (!challengeId || !keyId || !assertion || !clientDataHash || !bodySHA256) {
    throw new AppError(401, "App Attest assertion is required");
  }
  const challenge = await claimChallenge(env, credential, challengeId, "assertion", keyId);
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  const actualBodyHash = await sha256Hex(new Uint8Array(await request.clone().arrayBuffer()));
  if (
    challenge.method !== request.method.toUpperCase() || challenge.path !== target ||
    challenge.body_sha256 !== bodySHA256 || actualBodyHash !== bodySHA256 ||
    !challenge.expected_client_data_hash || !timingSafeEqual(challenge.expected_client_data_hash, clientDataHash)
  ) {
    await markChallengeResult(env.DB, challenge.challenge_id, "binding_mismatch");
    throw new AppError(403, "App Attest request binding mismatch");
  }
  const identity = await env.DB.prepare(`${installationIdentitySelect()} WHERE principal = ? AND token_reference = ?`)
    .bind(credential.principal, credential.tokenReference).first<InstallationIdentityRow>();
  if (!identity) throw new AppError(401, "Installation credential is not recognized");
  if (isBuiltInAppAttestVerifierConfigured(env)) {
    const allowedEnvironments = (env.APP_ATTEST_ALLOWED_ENVIRONMENTS ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean);
    if (!identity.app_attest_environment || !allowedEnvironments.includes(identity.app_attest_environment)) {
      await markChallengeResult(env.DB, challenge.challenge_id, "environment_mismatch");
      throw new AppError(403, "App Attest environment is not allowed");
    }
  }
  const publicKeySpki = identity.app_attest_public_key_spki
    ? boundedBytes(identity.app_attest_public_key_spki)
    : undefined;
  const verification = await verifyWithConfiguredService(env, {
    kind: "assertion", keyId, clientDataHash, artifact: assertion, principal: credential.principal
  }, publicKeySpki);
  if (!verification.verified) {
    await markChallengeResult(env.DB, challenge.challenge_id, "rejected");
    throw new AppError(403, "App Attest assertion failed");
  }
  const assertionCounter = verification.assertionCounter;
  if (!Number.isSafeInteger(assertionCounter) || (assertionCounter ?? 0) <= 0) {
    await markChallengeResult(env.DB, challenge.challenge_id, "counter_missing");
    throw new AppError(503, "App Attest verifier did not return a valid assertion counter");
  }
  const counterUpdate = await env.DB.prepare(
    `UPDATE installation_identities
     SET last_assertion_counter = ?, last_seen_at = ?
     WHERE principal = ? AND token_reference = ? AND revoked_at IS NULL
       AND last_assertion_counter < ?`
  ).bind(assertionCounter, new Date().toISOString(), credential.principal,
    credential.tokenReference, assertionCounter).run();
  if (Number(counterUpdate.meta?.changes ?? 0) !== 1) {
    await markChallengeResult(env.DB, challenge.challenge_id, "counter_replay");
    throw new AppError(409, "App Attest assertion counter was already used");
  }
  await markChallengeResult(env.DB, challenge.challenge_id, "verified");
}

export function installationQuotaSubject(credential: InstallationCredential): string {
  return credential.principal;
}

async function claimChallenge(
  env: Env,
  credential: InstallationCredential,
  challengeId: string,
  purpose: "attestation" | "assertion",
  keyId: string
): Promise<AppAttestChallengeRow> {
  const row = await env.DB.prepare(
    `SELECT challenge_id, principal, token_reference, purpose, key_id_hash,
            expected_client_data_hash, method, path, body_sha256, expires_at, consumed_at
     FROM app_attest_challenges WHERE challenge_id = ?`
  ).bind(challengeId).first<AppAttestChallengeRow>();
  const keyHash = await hmacHex(env.INSTALLATION_NETWORK_HMAC_KEY_V1!, `app-attest-key\0${keyId}`);
  if (!row || row.principal !== credential.principal || row.token_reference !== credential.tokenReference ||
      row.purpose !== purpose || row.key_id_hash !== keyHash) {
    throw new AppError(403, "App Attest challenge mismatch");
  }
  if (row.consumed_at) throw new AppError(409, "App Attest challenge was already used");
  if (Date.parse(row.expires_at) <= Date.now()) throw new AppError(410, "App Attest challenge expired");
  const consumedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE app_attest_challenges SET consumed_at = ?, result = 'verifying' WHERE challenge_id = ? AND consumed_at IS NULL"
  ).bind(consumedAt, challengeId).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new AppError(409, "App Attest challenge was already used");
  return row;
}

async function verifyWithConfiguredService(
  env: Env,
  input: Parameters<AppAttestVerifier>[0],
  publicKeySpki?: Uint8Array
): Promise<AppAttestVerificationResult> {
  if (testVerifier) return normalizeVerifierResult(await testVerifier(input));
  if (isBuiltInAppAttestVerifierConfigured(env)) {
    try {
      if (input.kind === "attestation") {
        const result = await verifyBuiltInAttestation(env, input);
        return { verified: true, publicKeySpki: result.publicKeySpki, environment: result.environment };
      }
      if (!publicKeySpki) throw new Error("app_attest_public_key_missing");
      return {
        verified: true,
        assertionCounter: await verifyBuiltInAssertion(env, { ...input, publicKeySpki })
      };
    } catch (error) {
      logWarnEvent("app_attest_verification_rejected", {
        kind: input.kind,
        failureClass: builtInVerificationFailureClass(error)
      });
      return { verified: false };
    }
  }
  const url = env.APP_ATTEST_VERIFIER_URL?.trim();
  const secret = env.APP_ATTEST_VERIFIER_SHARED_SECRET?.trim();
  if (!url || !secret) throw new AppError(503, "App Attest verification is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new AppError(503, "App Attest verification is temporarily unavailable");
  const body = await response.json() as { verified?: unknown; assertionCounter?: unknown };
  return {
    verified: body.verified === true,
    ...(typeof body.assertionCounter === "number" ? { assertionCounter: body.assertionCounter } : {})
  };
}

function normalizeVerifierResult(
  result: boolean | {
    verified: boolean;
    assertionCounter?: number;
    publicKeySpki?: Uint8Array;
    environment?: "development" | "production";
  }
): AppAttestVerificationResult {
  return typeof result === "boolean" ? { verified: result } : result;
}

async function markChallengeResult(db: D1Database, challengeId: string, result: string): Promise<void> {
  await db.prepare("UPDATE app_attest_challenges SET result = ? WHERE challenge_id = ?").bind(result, challengeId).run();
}

async function findStrictBootstrapIdentity(
  db: D1Database,
  operationHash: string,
  legacyHash: string
): Promise<InstallationIdentityRow | null> {
  const [operationIdentity, legacyIdentity] = await Promise.all([
    findIdentityByBootstrapOperationHash(db, operationHash),
    findIdentityByLegacyHash(db, legacyHash)
  ]);
  if (!operationIdentity && !legacyIdentity) return null;
  if (!operationIdentity || !legacyIdentity || operationIdentity.principal !== legacyIdentity.principal ||
      operationIdentity.legacy_device_key_hash !== legacyHash ||
      legacyIdentity.bootstrap_operation_hash !== operationHash) {
    throw new AppError(409, "Installation bootstrap idempotency conflict");
  }
  return operationIdentity;
}

async function findIdentityByBootstrapOperationHash(db: D1Database, operationHash: string) {
  return db.prepare(`${installationIdentitySelect()} WHERE bootstrap_operation_hash = ? LIMIT 1`)
    .bind(operationHash).first<InstallationIdentityRow>();
}

async function findIdentityByLegacyHash(db: D1Database, legacyHash: string) {
  return db.prepare(`${installationIdentitySelect()} WHERE legacy_device_key_hash = ? LIMIT 1`)
    .bind(legacyHash).first<InstallationIdentityRow>();
}

async function findIdentityByAppAttestKeyHash(db: D1Database, keyHash: string) {
  return db.prepare(`${installationIdentitySelect()} WHERE app_attest_key_hash = ? LIMIT 1`)
    .bind(keyHash).first<InstallationIdentityRow>();
}

function installationIdentitySelect(): string {
  return `SELECT principal, token_reference, token_version, attestation_status, credit_mode,
                 app_attest_key_hash, legacy_device_key_hash, bootstrap_operation_hash,
                 issued_at, token_expires_at, revoked_at, last_assertion_counter,
                 app_attest_public_key_spki, app_attest_environment
          FROM installation_identities`;
}

async function refreshExistingBootstrapIdentity(
  env: Env,
  row: InstallationIdentityRow,
  requestedKeyHash: string | null
): Promise<InstallationIdentityRow> {
  // App Attest keys can become invalid after an environment transition or an
  // Apple-side key loss. This function is reached only after both the opaque
  // bootstrap operation and legacy installation key resolve to the same
  // principal, so that strict pair may rotate its own App Attest key without
  // minting a new principal or moving balances.
  const rotatesBoundKey = Boolean(
    requestedKeyHash && row.app_attest_key_hash && requestedKeyHash !== row.app_attest_key_hash
  );
  const upgradesUnavailable = row.attestation_status === "unavailable" && Boolean(requestedKeyHash);
  const upgradesLegacyVerified = row.attestation_status === "verified"
    && Boolean(requestedKeyHash)
    && isBuiltInAppAttestVerifierConfigured(env)
    && !hasCurrentBuiltInVerificationMaterial(env, row);
  const requiresAttestationUpgrade = upgradesUnavailable || upgradesLegacyVerified || rotatesBoundKey;
  if (requiresAttestationUpgrade) {
    const keyOwner = await findIdentityByAppAttestKeyHash(env.DB, requestedKeyHash!);
    if (keyOwner && keyOwner.principal !== row.principal) {
      throw new AppError(409, "App Attest key is already registered");
    }
  }
  const expiryMs = Date.parse(resolveTokenExpiry(row));
  const rotatesSoon = !Number.isFinite(expiryMs) || expiryMs <= Date.now() + INSTALLATION_CREDENTIAL_ROTATION_WINDOW_MS;
  if (!requiresAttestationUpgrade && !rotatesSoon) return row;

  const issuedAt = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.parse(issuedAt) + INSTALLATION_CREDENTIAL_TTL_MS).toISOString();
  const tokenReference = `itok_${base64Url(crypto.getRandomValues(new Uint8Array(18)))}`;
  const result = await env.DB.prepare(
    `UPDATE installation_identities
     SET token_reference = ?, token_version = token_version + 1, issued_at = ?, token_expires_at = ?,
         last_seen_at = ?, app_attest_key_hash = COALESCE(?, app_attest_key_hash),
         attestation_status = CASE WHEN ? IS NULL THEN attestation_status ELSE 'pending' END,
         credit_mode = CASE WHEN ? IS NULL THEN credit_mode ELSE 'none' END,
         last_assertion_counter = CASE WHEN ? IS NULL THEN last_assertion_counter ELSE 0 END,
         app_attest_public_key_spki = CASE WHEN ? IS NULL THEN app_attest_public_key_spki ELSE NULL END,
         app_attest_environment = CASE WHEN ? IS NULL THEN app_attest_environment ELSE NULL END
     WHERE principal = ? AND token_reference = ? AND revoked_at IS NULL`
  ).bind(
    tokenReference, issuedAt, tokenExpiresAt, issuedAt,
    requiresAttestationUpgrade ? requestedKeyHash : null,
    requiresAttestationUpgrade ? requestedKeyHash : null,
    requiresAttestationUpgrade ? requestedKeyHash : null,
    requiresAttestationUpgrade ? requestedKeyHash : null,
    requiresAttestationUpgrade ? requestedKeyHash : null,
    requiresAttestationUpgrade ? requestedKeyHash : null,
    row.principal, row.token_reference
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new AppError(409, "Installation credential was replaced");
  const refreshed = await env.DB.prepare(`${installationIdentitySelect()} WHERE principal = ?`)
    .bind(row.principal).first<InstallationIdentityRow>();
  if (!refreshed) throw new AppError(503, "Installation identity refresh failed");
  if (rotatesBoundKey) {
    logEvent("installation_app_attest_key_rotated", { principalHash: hashForLog(row.principal) });
  }
  return refreshed;
}

function boundedBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  return new Uint8Array(value);
}

function hasCurrentBuiltInVerificationMaterial(env: Env, row: InstallationIdentityRow): boolean {
  const publicKeyLength = row.app_attest_public_key_spki
    ? boundedBytes(row.app_attest_public_key_spki).byteLength
    : 0;
  const allowedEnvironments = (env.APP_ATTEST_ALLOWED_ENVIRONMENTS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return publicKeyLength >= 80 && publicKeyLength <= 120
    && Boolean(row.app_attest_environment)
    && allowedEnvironments.includes(row.app_attest_environment!);
}

function builtInVerificationFailureClass(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]{1,80}$/.test(message) ? message : "cryptographic_verification_failed";
}

async function incrementBootstrapWindow(db: D1Database, networkKey: string): Promise<number> {
  const now = new Date();
  const windowStart = now.toISOString().slice(0, 13) + ":00:00.000Z";
  const row = await db.prepare(
    `INSERT INTO installation_bootstrap_limits (
      network_route_key, window_start, accepted_count, rejected_count, updated_at
    ) VALUES (?, ?, 1, 0, ?)
    ON CONFLICT(network_route_key, window_start) DO UPDATE SET
      accepted_count = installation_bootstrap_limits.accepted_count + 1,
      updated_at = excluded.updated_at
    RETURNING accepted_count`
  ).bind(networkKey, windowStart, now.toISOString()).first<{ accepted_count: number }>();
  return Number(row?.accepted_count ?? 1);
}

async function buildNetworkRouteKey(env: Env, request: Request, route: string): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const asn = request.headers.get("cf-asn")?.trim() || request.cf?.asn?.toString() || "unknown";
  const digest = await hmacHex(env.INSTALLATION_NETWORK_HMAC_KEY_V1!, `${route}\0${ip}\0${asn}`);
  return `network:v1:${digest}`;
}

async function credentialFromRow(env: Env, row: InstallationIdentityRow): Promise<InstallationCredential> {
  const expiresAt = resolveTokenExpiry(row);
  const payload: InstallationTokenPayload = {
    v: 1,
    p: row.principal,
    r: row.token_reference,
    iat: row.issued_at,
    tv: row.token_version,
    exp: Math.floor(Date.parse(expiresAt) / 1_000),
    att: row.attestation_status,
    cm: row.credit_mode
  };
  return {
    token: await signToken(env, payload), principal: row.principal, tokenReference: row.token_reference,
    tokenVersion: row.token_version, issuedAt: row.issued_at, expiresAt,
    attestationStatus: row.attestation_status, creditMode: row.credit_mode
  };
}

function resolveTokenExpiry(row: InstallationIdentityRow): string {
  const configured = row.token_expires_at;
  if (configured && Number.isFinite(Date.parse(configured))) return new Date(configured).toISOString();
  const issuedAtMs = Date.parse(row.issued_at);
  if (!Number.isFinite(issuedAtMs)) return new Date(0).toISOString();
  return new Date(issuedAtMs + INSTALLATION_CREDENTIAL_TTL_MS).toISOString();
}

async function signToken(env: Env, payload: InstallationTokenPayload): Promise<string> {
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${base64Url(await hmacBytes(env.INSTALLATION_TOKEN_HMAC_KEY_V1!, encoded))}`;
}

async function verifyToken(env: Env, token: string): Promise<InstallationTokenPayload> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw new AppError(401, "Invalid installation credential");
  const expected = base64Url(await hmacBytes(env.INSTALLATION_TOKEN_HMAC_KEY_V1!, encoded));
  if (!timingSafeEqual(signature, expected)) throw new AppError(401, "Invalid installation credential");
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as InstallationTokenPayload;
    if (payload.v !== 1 || !payload.p || !payload.r || !payload.iat ||
        (payload.tv !== undefined && (!Number.isSafeInteger(payload.tv) || payload.tv < 1)) ||
        (payload.exp !== undefined && (!Number.isSafeInteger(payload.exp) || payload.exp <= 0)) ||
        !["pending", "verified", "unavailable"].includes(payload.att)) {
      throw new Error("invalid");
    }
    if (payload.exp !== undefined && payload.exp <= Math.floor(Date.now() / 1_000)) {
      throw new AppError(401, "Installation credential has expired");
    }
    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "Invalid installation credential");
  }
}

function requireIdentityConfiguration(env: Env): void {
  if (!env.INSTALLATION_TOKEN_HMAC_KEY_V1?.trim() || !env.INSTALLATION_NETWORK_HMAC_KEY_V1?.trim() || !env.DB) {
    throw new AppError(503, "Installation identity is not configured");
  }
}

async function hmacBytes(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  return [...await hmacBytes(secret, value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildExpectedAppAttestClientDataHash(input: {
  purpose: "attestation" | "assertion";
  nonce: string;
  keyId: string;
  method: string | null;
  path: string | null;
  bodySHA256: string | null;
  installationPrincipal: string;
  tokenReference: string;
}): Promise<string> {
  const payload = input.purpose === "attestation"
    ? {
        installationPrincipal: input.installationPrincipal,
        keyId: input.keyId,
        nonce: input.nonce,
        purpose: "attestation",
        tokenReference: input.tokenReference,
        version: "kabuyomi-app-attest-key-v1"
      }
    : {
        bodySHA256: input.bodySHA256,
        installationPrincipal: input.installationPrincipal,
        method: input.method,
        nonce: input.nonce,
        path: input.path,
        tokenReference: input.tokenReference,
        version: "kabuyomi-app-attest-request-v1"
      };
  const digest = await sha256Bytes(stableJson(payload));
  return standardBase64(digest);
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function standardBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
