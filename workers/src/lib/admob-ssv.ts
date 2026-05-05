import type { Env } from "../env";

const DEFAULT_ADMOB_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

interface AdMobPublicKey {
  keyId: number;
  base64: string;
}

interface AdMobPublicKeysResponse {
  keys?: AdMobPublicKey[];
}

export async function verifyAdMobSsvCallback(url: URL, env: Env): Promise<boolean> {
  const queryString = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const signatureMarker = "&signature=";
  const signatureIndex = queryString.indexOf(signatureMarker);
  if (signatureIndex <= 0) {
    return false;
  }

  const signedContent = queryString.slice(0, signatureIndex);
  const signatureAndKey = queryString.slice(signatureIndex + 1);
  const params = new URLSearchParams(signatureAndKey);
  const signature = params.get("signature");
  const keyIdRaw = params.get("key_id");
  const keyId = Number.parseInt(keyIdRaw ?? "", 10);
  if (!signature || !Number.isFinite(keyId)) {
    return false;
  }

  const publicKey = await loadAdMobPublicKey(env, keyId);
  if (!publicKey) {
    return false;
  }

  const signatureBytes = normalizeEcdsaSignature(base64UrlDecode(signature));
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(new TextEncoder().encode(signedContent))
  );
}

async function loadAdMobPublicKey(env: Env, keyId: number): Promise<CryptoKey | null> {
  const keysUrl = env.ADMOB_SSV_PUBLIC_KEYS_URL || DEFAULT_ADMOB_KEYS_URL;
  const response = await fetch(keysUrl);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as AdMobPublicKeysResponse;
  const key = payload.keys?.find((candidate) => candidate.keyId === keyId);
  if (!key) {
    return null;
  }

  return crypto.subtle.importKey(
    "spki",
    toArrayBuffer(base64Decode(key.base64)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(normalized);
}

function base64Decode(value: string): Uint8Array {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function normalizeEcdsaSignature(signature: Uint8Array): Uint8Array {
  if (signature.length === 64 || signature[0] !== 0x30) {
    return signature;
  }

  let offset = 2;
  if ((signature[1] ?? 0) & 0x80) {
    offset = 2 + ((signature[1] ?? 0) & 0x7f);
  }
  const r = readDerInteger(signature, offset);
  const s = readDerInteger(signature, r.nextOffset);
  const raw = new Uint8Array(64);
  raw.set(toFixedInteger(r.value, 32), 0);
  raw.set(toFixedInteger(s.value, 32), 32);
  return raw;
}

function readDerInteger(bytes: Uint8Array, offset: number): { value: Uint8Array; nextOffset: number } {
  if (bytes[offset] !== 0x02) {
    throw new Error("Invalid ECDSA DER signature");
  }
  const length = bytes[offset + 1] ?? 0;
  const start = offset + 2;
  return {
    value: bytes.slice(start, start + length),
    nextOffset: start + length
  };
}

function toFixedInteger(value: Uint8Array, length: number): Uint8Array {
  let stripped = value;
  while (stripped.length > length && stripped[0] === 0) {
    stripped = stripped.slice(1);
  }
  if (stripped.length > length) {
    throw new Error("ECDSA integer is too large");
  }
  const fixed = new Uint8Array(length);
  fixed.set(stripped, length - stripped.length);
  return fixed;
}
