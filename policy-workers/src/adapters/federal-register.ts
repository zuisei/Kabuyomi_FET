import { classifyDomain, classifyInstrument } from "../catalog.ts";
import type { SourceAdapter } from "./types.ts";

export type FederalRegisterAgency = { raw_name?: string; name?: string; short_name?: string; slug?: string };
export type FederalRegisterDocument = {
  title: string;
  type: "Rule" | "Proposed Rule" | "Notice" | "Presidential Document" | string;
  abstract: string | null;
  document_number: string;
  html_url: string;
  pdf_url: string | null;
  public_inspection_pdf_url: string | null;
  publication_date: string;
  effective_on?: string | null;
  comments_close_on?: string | null;
  agencies: FederalRegisterAgency[];
  docket_ids?: string[];
  regulation_id_numbers?: string[];
  cfr_references?: Array<{ title: number; part: number }>;
  executive_order_number?: string | null;
  signing_date?: string | null;
};

type FederalRegisterResponse = { count: number; results: FederalRegisterDocument[] };

export class FederalRegisterAdapter implements SourceAdapter<FederalRegisterDocument> {
  readonly code = "federal-register";
  readonly displayName = "Federal Register / Public Inspection";
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) { this.fetcher = fetcher; }

  async discover(limit: number): Promise<FederalRegisterDocument[]> {
    const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
    url.searchParams.set("per_page", String(Math.min(Math.max(limit, 1), 1000)));
    url.searchParams.set("order", "newest");
    for (const field of ["title", "type", "abstract", "document_number", "html_url", "pdf_url", "public_inspection_pdf_url", "publication_date", "effective_on", "comments_close_on", "agencies", "docket_ids", "regulation_id_numbers", "cfr_references", "executive_order_number", "signing_date"]) {
      url.searchParams.append("fields[]", field);
    }
    const response = await this.fetcher(url, { headers: { accept: "application/json", "user-agent": "MarketDocket/0.1 policy-event research" } });
    if (!response.ok) throw new Error(`Federal Register returned HTTP ${response.status}`);
    const payload = await response.json() as FederalRegisterResponse;
    return payload.results;
  }
}

export type MappedFederalRegisterEvent = {
  externalID: string;
  agencyCode: string;
  agencyName: string;
  domainSlug: string;
  domainLabelJA: string;
  category: string;
  instrumentType: string;
  title: string;
  abstract: string | null;
  publicationDate: string;
  effectiveOn: string | null;
  commentsCloseOn: string | null;
  officialURL: string;
  govInfoPDFURL: string | null;
  publicInspectionPDFURL: string | null;
  docketIDs: string[];
  rin: string[];
  cfr: string[];
};

const agencyCodes: Array<[RegExp, string]> = [
  [/Executive Office of the President/i, "EOP"],
  [/Office of the United States Trade Representative/i, "USTR"],
  [/Securities and Exchange Commission/i, "SEC"],
  [/Environmental Protection Agency/i, "EPA"],
  [/Food and Drug Administration/i, "FDA"],
  [/Federal Aviation Administration/i, "FAA"],
  [/Federal Communications Commission/i, "FCC"],
  [/Federal Trade Commission/i, "FTC"],
  [/Federal Energy Regulatory Commission/i, "FERC"],
  [/Bureau of Industry and Security/i, "BIS"],
  [/Office of Foreign Assets Control/i, "OFAC"],
  [/Department of Transportation/i, "DOT"],
  [/Department of Commerce/i, "DOC"],
  [/Department of Energy/i, "DOE"],
  [/Department of the Treasury/i, "TREAS"],
  [/Department of Defense/i, "DOD"],
  [/Department of Labor/i, "DOL"],
  [/Department of Justice/i, "DOJ"],
  [/Department of Agriculture/i, "USDA"],
  [/Department of Health and Human Services/i, "HHS"]
];

function normalizedAgencyCode(primary: FederalRegisterAgency | undefined, agencyName: string): string {
  const known = agencyCodes.find(([pattern]) => pattern.test(agencyName));
  if (known) return known[1];
  if (primary?.short_name) {
    const short = primary.short_name.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
    if (short) return short;
  }
  const acronym = agencyName
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word && !["AND", "OF", "THE", "FOR", "UNITED", "STATES"].includes(word.toUpperCase()))
    .map((word) => word[0]?.toUpperCase())
    .join("")
    .slice(0, 10);
  return acronym || "FR";
}

export function mapFederalRegisterDocument(document: FederalRegisterDocument): MappedFederalRegisterEvent {
  const agencyNames = document.agencies.map((agency) => agency.raw_name ?? agency.name ?? agency.short_name ?? "Federal Register");
  const primary = document.agencies[0];
  const domain = classifyDomain(document.title, agencyNames);
  return {
    externalID: document.document_number,
    agencyCode: normalizedAgencyCode(primary, agencyNames[0] ?? "Federal Register"),
    agencyName: agencyNames[0] ?? "Federal Register",
    domainSlug: domain.slug,
    domainLabelJA: domain.labelJA,
    category: domain.swiftValue,
    instrumentType: classifyInstrument(document.type, document.title),
    title: document.title,
    abstract: document.abstract,
    publicationDate: document.publication_date,
    effectiveOn: document.effective_on ?? null,
    commentsCloseOn: document.comments_close_on ?? null,
    officialURL: document.html_url,
    govInfoPDFURL: document.pdf_url,
    publicInspectionPDFURL: document.public_inspection_pdf_url,
    docketIDs: document.docket_ids ?? [],
    rin: document.regulation_id_numbers ?? [],
    cfr: (document.cfr_references ?? []).map((reference) => `${reference.title} CFR ${reference.part}`)
  };
}
