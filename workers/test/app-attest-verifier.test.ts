import { encode } from "cbor-x";
import { describe, expect, it } from "vitest";
import {
  isBuiltInAppAttestVerifierConfigured,
  verifyBuiltInAssertion,
  verifyBuiltInAttestation
} from "../src/lib/app-attest-verifier";
import appleValidationGuide from "./fixtures/apple-app-attest-validation-guide.json";

const env = {
  APP_ATTEST_TEAM_ID: "UGCJZH9KG4",
  APP_ATTEST_BUNDLE_ID: "app.kabuyomi.ios",
  APP_ATTEST_ALLOWED_ENVIRONMENTS: "development",
  APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: "3",
  APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: "6",
  APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS: "true"
} as any;

describe("built-in App Attest verifier", () => {
  it("requires the complete authoritative app metadata set", () => {
    expect(isBuiltInAppAttestVerifierConfigured(env)).toBe(true);
    for (const key of [
      "APP_ATTEST_TEAM_ID",
      "APP_ATTEST_BUNDLE_ID",
      "APP_ATTEST_ALLOWED_ENVIRONMENTS",
      "APP_ATTEST_ALLOWED_BUNDLE_VERSIONS"
    ]) {
      expect(isBuiltInAppAttestVerifierConfigured({ ...env, [key]: "" })).toBe(false);
    }
  });

  it("verifies a path-independent Apple assertion signature and exposes its monotonic counter", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
    );
    const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
    const clientDataHash = crypto.getRandomValues(new Uint8Array(32));
    const extensions = encode({
      apple_validation_category_01: new Uint8Array([3, 0, 0, 0]),
      apple_bundle_version_01: "6"
    });
    const authData = new Uint8Array(37 + extensions.byteLength);
    authData.set(await digest(new TextEncoder().encode("UGCJZH9KG4.app.kabuyomi.ios")), 0);
    authData[32] = 0x80;
    new DataView(authData.buffer).setUint32(33, 7, false);
    authData.set(extensions, 37);
    const nonce = await digest(concat(authData, clientDataHash));
    const rawSignature = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, ownedBuffer(nonce)
    ));
    const artifact = encode({
      signature: rawEcdsaToDer(rawSignature),
      authenticatorData: authData
    });

    await expect(verifyBuiltInAssertion(env, {
      artifact: base64(artifact),
      clientDataHash: base64(clientDataHash),
      publicKeySpki
    })).resolves.toBe(7);

    await expect(verifyBuiltInAssertion({ ...env, APP_ATTEST_BUNDLE_ID: "app.example.wrong" }, {
      artifact: base64(artifact),
      clientDataHash: base64(clientDataHash),
      publicKeySpki
    })).rejects.toThrow("assertion_app_id_mismatch");

    const withoutExtensions = authData.slice(0, 37);
    withoutExtensions[32] = 0;
    const nonceWithoutExtensions = await digest(concat(withoutExtensions, clientDataHash));
    const signatureWithoutExtensions = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, ownedBuffer(nonceWithoutExtensions)
    ));
    await expect(verifyBuiltInAssertion(env, {
      artifact: base64(encode({
        signature: rawEcdsaToDer(signatureWithoutExtensions),
        authenticatorData: withoutExtensions
      })),
      clientDataHash: base64(clientDataHash),
      publicKeySpki
    })).resolves.toBe(7);

    await expect(verifyBuiltInAssertion({
      ...env,
      APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS: "false"
    }, {
      artifact: base64(encode({
        signature: rawEcdsaToDer(signatureWithoutExtensions),
        authenticatorData: withoutExtensions
      })),
      clientDataHash: base64(clientDataHash),
      publicKeySpki
    })).rejects.toThrow("attestation_extensions_missing");

    const withoutExtensionFlag = authData.slice();
    withoutExtensionFlag[32] = 0;
    const nonceWithoutExtensionFlag = await digest(concat(withoutExtensionFlag, clientDataHash));
    const signatureWithoutExtensionFlag = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, ownedBuffer(nonceWithoutExtensionFlag)
    ));
    await expect(verifyBuiltInAssertion(env, {
      artifact: base64(encode({
        signature: rawEcdsaToDer(signatureWithoutExtensionFlag),
        authenticatorData: withoutExtensionFlag
      })),
      clientDataHash: base64(clientDataHash),
      publicKeySpki
    })).rejects.toThrow("assertion_extensions_flag_missing");
  });

  it("fails closed before trust when an attestation object is malformed", async () => {
    await expect(verifyBuiltInAttestation(env, {
      artifact: base64(encode({ fmt: "not-apple", attStmt: {}, authData: new Uint8Array() })),
      clientDataHash: base64(new Uint8Array(32)),
      keyId: "invalid"
    })).rejects.toThrow("unexpected_attestation_format");
  });

  it("passes Apple's official attestation validation guide vector step for step", async () => {
    const guideEnv = {
      APP_ATTEST_TEAM_ID: appleValidationGuide.teamId,
      APP_ATTEST_BUNDLE_ID: appleValidationGuide.bundleId,
      APP_ATTEST_ALLOWED_ENVIRONMENTS: appleValidationGuide.environment,
      APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: String(appleValidationGuide.validationCategory),
      APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: appleValidationGuide.bundleVersion
    } as any;
    const input = {
      keyId: appleValidationGuide.keyId,
      clientDataHash: base64(new TextEncoder().encode(appleValidationGuide.serverChallenge)),
      artifact: appleValidationGuide.attestationObject
    };

    const verified = await verifyBuiltInAttestation(
      guideEnv,
      input,
      new Date(appleValidationGuide.verificationDate)
    );

    expect(verified.environment).toBe("production");
    expect(verified.publicKeySpki.byteLength).toBeGreaterThan(64);
    await expect(verifyBuiltInAttestation(
      { ...guideEnv, APP_ATTEST_BUNDLE_ID: "com.example.wrong" },
      input,
      new Date(appleValidationGuide.verificationDate)
    )).rejects.toThrow("attestation_app_id_mismatch");
    await expect(verifyBuiltInAttestation(
      guideEnv,
      input,
      new Date("2026-07-13T00:00:00.000Z")
    )).rejects.toThrow("attestation_certificate_expired_or_not_yet_valid");
  });
});

async function digest(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(value)));
}

function ownedBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const value = new Uint8Array(left.byteLength + right.byteLength);
  value.set(left);
  value.set(right, left.byteLength);
  return value;
}

function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function rawEcdsaToDer(signature: Uint8Array): Uint8Array {
  const integer = (component: Uint8Array): Uint8Array => {
    let first = 0;
    while (first < component.byteLength - 1 && component[first] === 0) first += 1;
    const trimmed = component.slice(first);
    const needsPadding = (trimmed[0] & 0x80) !== 0;
    const value = new Uint8Array(2 + trimmed.byteLength + (needsPadding ? 1 : 0));
    value[0] = 0x02;
    value[1] = trimmed.byteLength + (needsPadding ? 1 : 0);
    value.set(trimmed, needsPadding ? 3 : 2);
    return value;
  };
  const r = integer(signature.slice(0, 32));
  const s = integer(signature.slice(32, 64));
  const result = new Uint8Array(2 + r.byteLength + s.byteLength);
  result[0] = 0x30;
  result[1] = r.byteLength + s.byteLength;
  result.set(r, 2);
  result.set(s, 2 + r.byteLength);
  return result;
}
