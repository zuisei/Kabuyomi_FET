export type SourceAdapterHealth = "healthy" | "degraded" | "missing_credentials" | "disabled";

export interface SourceAdapter<T> {
  readonly code: string;
  readonly displayName: string;
  discover(limit: number): Promise<T[]>;
}

export type OfficialEvidenceLink = {
  source: "govinfo" | "federal_register" | "regulations_gov" | "white_house";
  url: string;
  identifier?: string;
};
