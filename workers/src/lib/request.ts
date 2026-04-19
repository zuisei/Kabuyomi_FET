import { z } from "zod";
import { AppError } from "./errors";

interface ParseJsonBodyOptions {
  invalidMessage: string;
  maxBytes: number;
  unsupportedMediaTypeMessage?: string;
  tooLargeMessage?: string;
  allowEmptyObject?: boolean;
}

export async function parseJsonBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
  options: ParseJsonBodyOptions
): Promise<z.infer<Schema>> {
  assertJsonContentType(request, options.unsupportedMediaTypeMessage ?? "Content-Type must be application/json");
  const raw = await readTextBodyWithLimit(
    request,
    options.maxBytes,
    options.tooLargeMessage ?? "Request body is too large"
  );

  let payload: unknown;
  if (!raw) {
    payload = options.allowEmptyObject ? {} : null;
  } else {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AppError(400, options.invalidMessage);
    }
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(400, options.invalidMessage);
  }

  return parsed.data;
}

function assertJsonContentType(request: Request, message: string): void {
  const contentType = request.headers.get("content-type");
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized !== "application/json") {
    throw new AppError(415, message);
  }
}

async function readTextBodyWithLimit(request: Request, maxBytes: number, tooLargeMessage: string): Promise<string> {
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError(413, tooLargeMessage);
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel(tooLargeMessage);
      } catch {
        // Best-effort cancellation only. The route still fails closed below.
      }
      throw new AppError(413, tooLargeMessage);
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}
