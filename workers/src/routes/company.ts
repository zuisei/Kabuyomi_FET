import { loadCompanyUsecase, refreshCompanyUsecase, type CompanyUsecaseResult } from "../lib/company/usecase";
import { badRequest, json, notFound } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleCompanyRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!url.pathname.startsWith("/v1/company/")) {
    return null;
  }

  const ticker = decodeURIComponent(url.pathname.split("/")[3] ?? "");
  if (!ticker) {
    return badRequest("Ticker is required");
  }

  if (request.method === "GET") {
    return companyResultToResponse(
      await loadCompanyUsecase({
        request,
        ticker,
        env,
        config,
        ctx
      })
    );
  }

  if (request.method === "POST" && url.pathname.endsWith("/refresh")) {
    return companyResultToResponse(
      await refreshCompanyUsecase({
        request,
        ticker,
        env,
        config,
        ctx
      })
    );
  }

  return null;
};

function companyResultToResponse(result: CompanyUsecaseResult): Response {
  switch (result.kind) {
    case "ok":
      return json(result.body);
    case "not_found":
      return notFound(result.message);
  }
}
