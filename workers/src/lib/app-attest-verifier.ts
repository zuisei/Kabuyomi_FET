import "reflect-metadata";
import { AsnParser } from "@peculiar/asn1-schema";
import { ECDSASigValue } from "@peculiar/asn1-ecc";
import { X509Certificate, X509ChainBuilder } from "@peculiar/x509";
import { decode, decodeMultiple } from "cbor-x";
import type { Env } from "../env";
import { logEvent, logWarnEvent } from "./logging";

// Pinned from Apple's certificate authority service. Keep the trust anchor in
// source so DNS or a remote certificate fetch cannot change verifier trust.
// https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
const APPLE_APP_ATTEST_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

const AAGUID_PRODUCTION = "appattest\0\0\0\0\0\0\0";
const AAGUID_DEVELOPMENT = "appattestdevelop";
const NONCE_EXTENSION_OID = "1.2.840.113635.100.8.2";

export interface BuiltInAttestationResult {
  publicKeySpki: Uint8Array;
  environment: "development" | "production";
}

interface ParsedAttestationAuthData {
  raw: Uint8Array;
  rpIdHash: Uint8Array;
  counter: number;
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  extensions: Map<unknown, unknown> | Record<string, unknown> | null;
}

export function isBuiltInAppAttestVerifierConfigured(env: Env): boolean {
  return Boolean(
    env.APP_ATTEST_TEAM_ID?.trim()
      && env.APP_ATTEST_BUNDLE_ID?.trim()
      && env.APP_ATTEST_ALLOWED_ENVIRONMENTS?.trim()
      && env.APP_ATTEST_ALLOWED_BUNDLE_VERSIONS?.trim()
  );
}

export async function verifyBuiltInAttestation(env: Env, input: {
  keyId: string;
  clientDataHash: string;
  artifact: string;
}, verificationDate = new Date()): Promise<BuiltInAttestationResult> {
  requireConfiguration(env);
  const object = decode(fromBase64(input.artifact)) as {
    fmt?: unknown;
    attStmt?: { x5c?: unknown; receipt?: unknown };
    authData?: unknown;
  };
  if (object.fmt !== "apple-appattest") throw new Error("unexpected_attestation_format");
  if (!Array.isArray(object.attStmt?.x5c) || object.attStmt.x5c.length !== 2) {
    throw new Error("invalid_attestation_chain");
  }
  const receipt = asBytes(object.attStmt.receipt, "invalid_attestation_receipt");
  if (receipt.byteLength === 0) throw new Error("invalid_attestation_receipt");
  const authData = asBytes(object.authData, "invalid_attestation_auth_data");
  const certificates = object.attStmt.x5c.map((value) => new X509Certificate(
    ownedBuffer(asBytes(value, "invalid_attestation_certificate"))
  ));
  const leaf = await validateCertificateChain(certificates, verificationDate);

  const clientDataHash = fromBase64(input.clientDataHash);
  if (clientDataHash.byteLength < 16 || clientDataHash.byteLength > 64) throw new Error("invalid_client_data_hash");
  const expectedNonce = await sha256(concat(authData, clientDataHash));
  if (!equal(expectedNonce, extractNonce(leaf))) throw new Error("attestation_nonce_mismatch");

  const parsed = parseAttestationAuthData(authData);
  const expectedRpIdHash = await sha256(new TextEncoder().encode(`${env.APP_ATTEST_TEAM_ID!.trim()}.${env.APP_ATTEST_BUNDLE_ID!.trim()}`));
  if (!equal(parsed.rpIdHash, expectedRpIdHash)) throw new Error("attestation_app_id_mismatch");
  if (parsed.counter !== 0) throw new Error("attestation_counter_not_zero");

  const aaguid = new TextDecoder().decode(parsed.aaguid);
  const environment = aaguid === AAGUID_DEVELOPMENT
    ? "development"
    : aaguid === AAGUID_PRODUCTION ? "production" : null;
  if (!environment || !csv(env.APP_ATTEST_ALLOWED_ENVIRONMENTS).includes(environment)) {
    throw new Error("attestation_environment_not_allowed");
  }

  const keyId = fromBase64Url(input.keyId);
  if (!equal(keyId, parsed.credentialId)) throw new Error("attestation_key_id_mismatch");

  const spki = new Uint8Array(leaf.publicKey.rawData);
  const cryptoKey = await crypto.subtle.importKey(
    "spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]
  );
  const rawPoint = new Uint8Array(await crypto.subtle.exportKey("raw", cryptoKey));
  if (!equal(await sha256(rawPoint), parsed.credentialId)) throw new Error("attestation_public_key_mismatch");

  verifyAppExtensions(parsed.extensions, env, "attestation");
  return { publicKeySpki: spki, environment };
}

export async function verifyBuiltInAssertion(env: Env, input: {
  clientDataHash: string;
  artifact: string;
  publicKeySpki: Uint8Array;
}): Promise<number> {
  requireConfiguration(env);
  const object = decode(fromBase64(input.artifact)) as { signature?: unknown; authenticatorData?: unknown };
  const signature = asBytes(object.signature, "invalid_assertion_signature");
  const authData = asBytes(object.authenticatorData, "invalid_assertion_auth_data");
  if (authData.byteLength < 37) throw new Error("invalid_assertion_auth_data");
  const hasExtensions = (authData[32] & 0x80) !== 0;
  if (!hasExtensions && authData.byteLength !== 37) throw new Error("assertion_extensions_flag_missing");

  const clientDataHash = fromBase64(input.clientDataHash);
  if (clientDataHash.byteLength < 16 || clientDataHash.byteLength > 64) throw new Error("invalid_client_data_hash");
  const expectedRpIdHash = await sha256(new TextEncoder().encode(`${env.APP_ATTEST_TEAM_ID!.trim()}.${env.APP_ATTEST_BUNDLE_ID!.trim()}`));
  if (!equal(authData.slice(0, 32), expectedRpIdHash)) throw new Error("assertion_app_id_mismatch");
  const extensions = hasExtensions
    ? decode(authData.slice(37)) as ParsedAttestationAuthData["extensions"]
    : null;
  verifyAppExtensions(extensions, env, "assertion");

  const publicKey = await crypto.subtle.importKey(
    "spki", ownedBuffer(input.publicKeySpki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const nonce = await sha256(concat(authData, clientDataHash));
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey,
    ownedBuffer(derEcdsaToRaw(signature)), ownedBuffer(nonce)
  );
  if (!valid) throw new Error("assertion_signature_invalid");
  return new DataView(authData.buffer, authData.byteOffset, authData.byteLength).getUint32(33, false);
}

function verifyAppExtensions(
  extensions: ParsedAttestationAuthData["extensions"],
  env: Env,
  stage: "attestation" | "assertion"
): void {
  if (!extensions) {
    if (env.APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS?.trim().toLowerCase() === "true") {
      // Production runs this allowance, and the early return used to be silent —
      // so nobody could tell how many real installs send attestations without
      // extensions, which is exactly what has to be known before the allowance
      // can be turned off. Note that returning here skips BOTH the validation
      // category and the bundle version check.
      logWarnEvent("app_attest_extensions_missing_allowed", {
        stage,
        allowedBundleVersions: env.APP_ATTEST_ALLOWED_BUNDLE_VERSIONS ?? null,
        allowedValidationCategories: env.APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES ?? "2,3,4"
      });
      return;
    }
    throw new Error("attestation_extensions_missing");
  }

  // Logged so the two paths can be compared: if extensions are effectively
  // always present, the allowance above can be removed safely.
  logEvent("app_attest_extensions_present", { stage });
  const value = (key: string): unknown => extensions instanceof Map ? extensions.get(key) : extensions[key];
  const category = decodeValidationCategory(value("apple_validation_category_01"));
  if (!Number.isSafeInteger(category) || !csv(env.APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES ?? "2,3,4").includes(String(category))) {
    throw new Error("attestation_validation_category_not_allowed");
  }
  const bundleVersion = String(value("apple_bundle_version_01") ?? "");
  if (!csv(env.APP_ATTEST_ALLOWED_BUNDLE_VERSIONS).includes(bundleVersion)) {
    throw new Error("attestation_bundle_version_not_allowed");
  }
}

function decodeValidationCategory(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (value instanceof Uint8Array && value.byteLength === 4) {
    return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true);
  }
  if (value instanceof ArrayBuffer && value.byteLength === 4) {
    return new DataView(value).getUint32(0, true);
  }
  return Number.NaN;
}

function parseAttestationAuthData(raw: Uint8Array): ParsedAttestationAuthData {
  if (raw.byteLength < 55) throw new Error("invalid_attestation_auth_data");
  if ((raw[32] & 0x40) === 0) throw new Error("attestation_credentials_flag_missing");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const credentialIdLength = view.getUint16(53, false);
  const credentialEnd = 55 + credentialIdLength;
  if (credentialEnd > raw.byteLength) throw new Error("invalid_attestation_credential_id");
  const trailing = raw.slice(credentialEnd);
  const decoded = decodeMultiple(trailing) as unknown as unknown[];
  if (decoded.length < 1 || decoded.length > 2) throw new Error("invalid_attestation_auth_data_components");
  const extensions = decoded.length === 2
    ? decoded[1] as ParsedAttestationAuthData["extensions"]
    : null;
  return {
    raw,
    rpIdHash: raw.slice(0, 32),
    counter: view.getUint32(33, false),
    aaguid: raw.slice(37, 53),
    credentialId: raw.slice(55, credentialEnd),
    extensions
  };
}

async function validateCertificateChain(certificates: X509Certificate[], verificationDate: Date): Promise<X509Certificate> {
  const root = new X509Certificate(ownedBuffer(pemToDer(APPLE_APP_ATTEST_ROOT_CA_PEM)));
  const chain = await new X509ChainBuilder({ certificates: [...certificates.slice(1), root] }).build(certificates[0]);
  if (chain.length !== 3 || !equal(new Uint8Array(chain.at(-1)!.rawData), new Uint8Array(root.rawData))) {
    throw new Error("attestation_untrusted_certificate_chain");
  }
  const verificationTime = verificationDate.getTime();
  if (!Number.isFinite(verificationTime)) throw new Error("attestation_invalid_verification_time");
  for (const certificate of chain) {
    if (verificationTime < certificate.notBefore.getTime() || verificationTime > certificate.notAfter.getTime()) {
      throw new Error("attestation_certificate_expired_or_not_yet_valid");
    }
  }
  const leafConstraints = chain[0].getExtension("2.5.29.19") as { ca?: boolean } | null;
  if (leafConstraints?.ca === true) throw new Error("attestation_leaf_is_ca");
  const leafKeyUsage = chain[0].getExtension("2.5.29.15") as { usages?: number } | null;
  if (!leafKeyUsage || ((leafKeyUsage.usages ?? 0) & 1) === 0) {
    throw new Error("attestation_leaf_cannot_sign");
  }
  for (const issuer of chain.slice(1)) {
    const constraints = issuer.getExtension("2.5.29.19") as { ca?: boolean } | null;
    if (!constraints?.ca) throw new Error("attestation_issuer_is_not_ca");
    const keyUsage = issuer.getExtension("2.5.29.15") as { usages?: number } | null;
    if (!keyUsage || ((keyUsage.usages ?? 0) & 32) === 0) {
      throw new Error("attestation_issuer_cannot_sign_certificates");
    }
  }
  return certificates[0];
}

function extractNonce(certificate: X509Certificate): Uint8Array {
  const extension = certificate.getExtension(NONCE_EXTENSION_OID);
  if (!extension) throw new Error("attestation_nonce_extension_missing");
  const raw = new Uint8Array(extension.value);
  const outer = readDerValue(raw, 0, 0x30);
  const context = readDerValue(outer.value, 0, 0xa1);
  const octets = readDerValue(context.value, 0, 0x04);
  if (octets.value.byteLength !== 32) throw new Error("attestation_nonce_invalid");
  return octets.value;
}

function readDerValue(bytes: Uint8Array, offset: number, expectedTag: number): { value: Uint8Array; end: number } {
  if (bytes[offset] !== expectedTag) throw new Error("invalid_der_tag");
  let cursor = offset + 1;
  let length = bytes[cursor++];
  if ((length & 0x80) !== 0) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new Error("invalid_der_length");
    length = 0;
    for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[cursor++];
  }
  const end = cursor + length;
  if (end > bytes.byteLength) throw new Error("truncated_der_value");
  return { value: bytes.slice(cursor, end), end };
}

function derEcdsaToRaw(signature: Uint8Array): Uint8Array {
  const parsed = AsnParser.parse(signature, ECDSASigValue);
  const raw = new Uint8Array(64);
  raw.set(normalizeInteger(new Uint8Array(parsed.r)), 0);
  raw.set(normalizeInteger(new Uint8Array(parsed.s)), 32);
  return raw;
}

function normalizeInteger(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 32) return bytes;
  if (bytes.byteLength === 33 && bytes[0] === 0) return bytes.slice(1);
  if (bytes.byteLength < 32) {
    const result = new Uint8Array(32);
    result.set(bytes, 32 - bytes.byteLength);
    return result;
  }
  throw new Error("invalid_ecdsa_signature");
}

function asBytes(value: unknown, error: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(error);
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(base64 + "=".repeat((4 - base64.length % 4) % 4));
}

function pemToDer(value: string): Uint8Array {
  return fromBase64(value.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""));
}

function concat(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(values.reduce((sum, value) => sum + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(value)));
}

function ownedBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function requireConfiguration(env: Env): void {
  if (!isBuiltInAppAttestVerifierConfigured(env)) throw new Error("app_attest_verifier_not_configured");
}
