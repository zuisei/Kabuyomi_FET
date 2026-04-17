import type { Env } from "../env";
import type { RemoteConfig } from "../lib/remote-config";

export interface RouteContext {
  request: Request;
  url: URL;
  env: Env;
  config: RemoteConfig;
  ctx: ExecutionContext;
}

export type RouteHandler = (context: RouteContext) => Promise<Response | null>;
