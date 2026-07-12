import type { Env } from "../env";
import { AppError } from "./errors";
import { hashForLog, logEvent } from "./logging";
import type { InstallationCredential } from "./installation-identity";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const ACCOUNT_PRINCIPAL_DOMAIN = "kabuyomi.account.principal.v1";
const ACCOUNT_TOKEN_DOMAIN = "kabuyomi.account.session.v1";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

interface AppleIdentityClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat?: number;
}

interface AccountSessionClaims {
  v: 1;
  accountPrincipal: string;
  appAccountToken: string;
  issuedAt: number;
  expiresAt: number;
}

export interface AccountCredential {
  token: string;
  accountPrincipal: string;
  appAccountToken: string;
  issuedAt: string;
  expiresAt: string;
}

type AppleIdentityVerifier = (token: string, env: Env) => Promise<AppleIdentityClaims>;
let testVerifier: AppleIdentityVerifier | undefined;
type AppleJwk = JsonWebKey & { kid?: string };
let jwksCache: { expiresAt: number; keys: AppleJwk[] } | undefined;

export function setAppleIdentityVerifierForTests(verifier?: AppleIdentityVerifier): void {
  testVerifier = verifier;
}

export async function createAccountSession(
  env: Env,
  identityToken: string,
  installation: InstallationCredential
): Promise<AccountCredential> {
  if (installation.attestationStatus !== "verified") {
    throw new AppError(403, "Verified installation is required");
  }
  const claims = testVerifier
    ? await testVerifier(identityToken, env)
    : await verifyAppleIdentityToken(identityToken, env);
  const secret = requiredSecret(env.ACCOUNT_PRINCIPAL_HMAC_KEY_V1, "Account recovery is not configured");
  const subjectDigest = await hmacBase64Url(secret, `apple-subject\0${claims.sub}`);
  const accountPrincipal = `account:v1:${await hmacBase64Url(secret, `${ACCOUNT_PRINCIPAL_DOMAIN}\0${claims.sub}`)}`;
  const appAccountToken = uuidFromBytes(
    (await hmacBytes(secret, `kabuyomi.app-account-token.v1\0${claims.sub}`)).slice(0, 16)
  );
  const installationDigest = await hmacBase64Url(secret, `installation-binding\0${installation.principal}`);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO account_principals (
      account_principal, apple_subject_digest, app_account_token, key_version, created_at, last_authenticated_at
    ) VALUES (?, ?, ?, 'v1', ?, ?)
    ON CONFLICT(account_principal) DO UPDATE SET last_authenticated_at = excluded.last_authenticated_at`
  ).bind(accountPrincipal, subjectDigest, appAccountToken, now, now).run();
  await env.DB.prepare(
    `INSERT INTO account_device_bindings (
      account_principal, installation_principal_digest, bound_at, last_seen_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(installation_principal_digest) DO UPDATE SET
      account_principal = excluded.account_principal,
      last_seen_at = excluded.last_seen_at`
  ).bind(accountPrincipal, installationDigest, now, now).run();

  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const sessionClaims: AccountSessionClaims = { v: 1, accountPrincipal, appAccountToken, issuedAt, expiresAt };
  const token = await signSessionClaims(env, sessionClaims);
  logEvent("apple_account_session_created", {
    accountPrincipalHash: hashForLog(accountPrincipal),
    installationPrincipalHash: hashForLog(installation.principal)
  });
  return {
    token,
    accountPrincipal,
    appAccountToken,
    issuedAt: new Date(issuedAt * 1_000).toISOString(),
    expiresAt: new Date(expiresAt * 1_000).toISOString()
  };
}

export async function resolveAccountCredential(request: Request, env: Env): Promise<AccountCredential> {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const raw = authorization.startsWith("Account ")
    ? authorization.slice("Account ".length).trim()
    : request.headers.get("x-kabuyomi-account-token")?.trim();
  if (!raw) throw new AppError(401, "Account sign-in is required");
  const parts = raw.split(".");
  if (parts.length !== 2) throw new AppError(401, "Invalid account session");
  const payloadBytes = base64UrlDecode(parts[0]);
  const signature = base64UrlDecode(parts[1]);
  const expected = await hmacBytes(
    requiredSecret(env.ACCOUNT_SESSION_HMAC_KEY_V1, "Account recovery is not configured"),
    `${ACCOUNT_TOKEN_DOMAIN}\0${parts[0]}`
  );
  if (!constantTimeEqual(signature, expected)) throw new AppError(401, "Invalid account session");
  let claims: AccountSessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as AccountSessionClaims;
  } catch {
    throw new AppError(401, "Invalid account session");
  }
  if (claims.v !== 1 || !claims.accountPrincipal?.startsWith("account:v1:") ||
      !isUuid(claims.appAccountToken) || claims.expiresAt <= Math.floor(Date.now() / 1_000)) {
    throw new AppError(401, "Account session expired or invalid");
  }
  const row = await env.DB.prepare(
    "SELECT account_principal, app_account_token FROM account_principals WHERE account_principal = ?"
  ).bind(claims.accountPrincipal).first<{ account_principal: string; app_account_token: string }>();
  if (!row || row.app_account_token !== claims.appAccountToken) throw new AppError(401, "Invalid account session");
  return {
    token: raw,
    accountPrincipal: claims.accountPrincipal,
    appAccountToken: claims.appAccountToken,
    issuedAt: new Date(claims.issuedAt * 1_000).toISOString(),
    expiresAt: new Date(claims.expiresAt * 1_000).toISOString()
  };
}

async function verifyAppleIdentityToken(token: string, env: Env): Promise<AppleIdentityClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AppError(401, "Invalid Apple identity token");
  let header: { alg?: string; kid?: string };
  let claims: AppleIdentityClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as typeof header;
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as AppleIdentityClaims;
  } catch {
    throw new AppError(401, "Invalid Apple identity token");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AppError(401, "Invalid Apple identity token");
  const clientId = (env.APPLE_SIGN_IN_CLIENT_ID ?? env.APPLE_BUNDLE_ID)?.trim();
  const now = Math.floor(Date.now() / 1_000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!clientId || claims.iss !== APPLE_ISSUER || !audience.includes(clientId) ||
      !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= now ||
      (claims.iat !== undefined && claims.iat > now + 300)) {
    throw new AppError(401, "Invalid Apple identity token claims");
  }
  const keys = await loadAppleJwks();
  const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new AppError(401, "Apple identity signing key is not trusted");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(base64UrlDecode(parts[2])).buffer;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new AppError(401, "Invalid Apple identity token signature");
  return claims;
}

async function loadAppleJwks(): Promise<AppleJwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(APPLE_JWKS_URL);
  if (!response.ok) throw new AppError(503, "Apple sign-in verification is temporarily unavailable");
  const body = await response.json() as { keys?: AppleJwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new AppError(503, "Apple sign-in verification is temporarily unavailable");
  jwksCache = { keys: body.keys, expiresAt: Date.now() + 60 * 60 * 1_000 };
  return body.keys;
}

async function signSessionClaims(env: Env, claims: AccountSessionClaims): Promise<string> {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await hmacBytes(
    requiredSecret(env.ACCOUNT_SESSION_HMAC_KEY_V1, "Account recovery is not configured"),
    `${ACCOUNT_TOKEN_DOMAIN}\0${payload}`
  );
  return `${payload}.${base64UrlEncode(signature)}`;
}

async function hmacBytes(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hmacBase64Url(secret: string, value: string): Promise<string> {
  return base64UrlEncode(await hmacBytes(secret, value));
}

function requiredSecret(value: string | undefined, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError(503, message);
  return normalized;
}

function uuidFromBytes(bytes: Uint8Array): string {
  const value = new Uint8Array(bytes);
  value[6] = (value[6] & 0x0f) | 0x40;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new AppError(401, "Invalid account token encoding");
  }
}
