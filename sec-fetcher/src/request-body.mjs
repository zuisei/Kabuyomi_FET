const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export class RequestBodyError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "RequestBodyError";
    this.statusCode = statusCode;
  }
}

export async function readJsonRequestBody(request, options = {}) {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  assertJsonContentType(request.headers["content-type"]);
  assertDeclaredContentLength(request.headers["content-length"], maxBytes);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        tooLarge = true;
        return;
      }

      chunks.push(buffer);
    });

    request.on("end", () => {
      if (tooLarge) {
        reject(new RequestBodyError(413, "Request body is too large"));
        return;
      }

      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new RequestBodyError(400, "Invalid JSON payload"));
      }
    });

    request.on("error", reject);
  });
}

function assertJsonContentType(rawContentType) {
  const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
  const normalized = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (normalized !== "application/json") {
    throw new RequestBodyError(415, "Content-Type must be application/json");
  }
}

function assertDeclaredContentLength(rawContentLength, maxBytes) {
  const headerValue = Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength;
  const declared = Number.parseInt(String(headerValue ?? ""), 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestBodyError(413, "Request body is too large");
  }
}

function normalizeMaxBytes(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? DEFAULT_MAX_BODY_BYTES), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_BYTES;
}
