const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function uuid(value: string, name: string): string {
  if (!UUID.test(value)) throw new TypeError(`${name} must be a UUID`);
  return value.toLowerCase();
}

export const StorageKey = {
  raw(sha256: string): string {
    const hash = sha256.toLowerCase();
    if (!SHA256.test(hash)) throw new TypeError("sha256 must contain 64 hexadecimal characters");
    return `v1/blobs/sha256/${hash.slice(0, 2)}/${hash}`;
  },
  normalized(documentId: string, revisionId: string): string {
    return `v1/documents/${uuid(documentId, "documentId")}/revisions/${uuid(revisionId, "revisionId")}/normalized.json`;
  },
  plainText(documentId: string, revisionId: string): string {
    return `v1/documents/${uuid(documentId, "documentId")}/revisions/${uuid(revisionId, "revisionId")}/plain.txt`;
  },
  diff(documentId: string, fromRevisionId: string, toRevisionId: string): string {
    return `v1/documents/${uuid(documentId, "documentId")}/diffs/${uuid(fromRevisionId, "fromRevisionId")}--${uuid(toRevisionId, "toRevisionId")}.json`;
  },
  temp(runId: string, jobId: string, leaf: "response.body" | "response.headers.json" | "parser-debug.json"): string {
    return `v1/runs/${uuid(runId, "runId")}/jobs/${uuid(jobId, "jobId")}/${leaf}`;
  }
};
