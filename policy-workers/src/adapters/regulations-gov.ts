import type { SourceAdapter, SourceAdapterHealth } from "./types.ts";

export type RegulationsDocument = { id: string; attributes: Record<string, unknown> };

export class RegulationsGovAdapter implements SourceAdapter<RegulationsDocument> {
  readonly code = "regulations-gov";
  readonly displayName = "Regulations.gov";
  readonly health: SourceAdapterHealth;
  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey?: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.health = apiKey ? "healthy" : "missing_credentials";
  }

  async discover(limit: number): Promise<RegulationsDocument[]> {
    if (!this.apiKey) throw new Error("REGULATIONS_GOV_API_KEY is required; DEMO_KEY is exploration-only");
    const url = new URL("https://api.regulations.gov/v4/documents");
    url.searchParams.set("page[size]", String(Math.min(Math.max(limit, 1), 250)));
    url.searchParams.set("sort", "-postedDate");
    const response = await this.fetcher(url, { headers: { accept: "application/vnd.api+json", "X-Api-Key": this.apiKey } });
    if (!response.ok) throw new Error(`Regulations.gov returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: RegulationsDocument[] };
    return payload.data ?? [];
  }
}
