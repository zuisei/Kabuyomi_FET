import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { RequestBodyError, readJsonRequestBody } from "../src/request-body.mjs";

test("readJsonRequestBody rejects non-json content types", async () => {
  const request = makeRequest({
    headers: { "content-type": "text/plain" },
    body: "{}"
  });

  await assert.rejects(
    () => readJsonRequestBody(request),
    (error) =>
      error instanceof RequestBodyError &&
      error.statusCode === 415 &&
      error.message === "Content-Type must be application/json"
  );
});

test("readJsonRequestBody rejects oversized bodies before buffering them", async () => {
  const body = JSON.stringify({ tickers: Array.from({ length: 64 }, (_, index) => `TICK${index}`) });
  const request = makeRequest({
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body))
    },
    body
  });

  await assert.rejects(
    () => readJsonRequestBody(request, { maxBytes: 32 }),
    (error) =>
      error instanceof RequestBodyError &&
      error.statusCode === 413 &&
      error.message === "Request body is too large"
  );
});

function makeRequest({ headers, body }) {
  const stream = new PassThrough();
  stream.headers = headers;
  queueMicrotask(() => {
    if (body !== undefined) {
      stream.end(body);
      return;
    }
    stream.end();
  });
  return stream;
}
