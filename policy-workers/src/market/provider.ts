export type MarketDataLicenseMode = "licensed_proxy" | "bring_your_own_key" | "market_disabled";

export type MarketBarsRequest = {
  symbol: string;
  interval: string;
  outputSize: number;
};

export type MarketQuoteRequest = { symbol: string };

export type ProviderMarketBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketBarsResponse = {
  symbol: string;
  providerID: string;
  attribution: string;
  isDelayed: boolean;
  bars: ProviderMarketBar[];
};

export type MarketQuoteResponse = {
  symbol: string;
  providerID: string;
  attribution: string;
  price: number;
  observedAt: string | null;
};

export interface MarketDataProvider {
  readonly providerID: string;
  readonly licenseMode: MarketDataLicenseMode;
  bars(request: MarketBarsRequest): Promise<MarketBarsResponse>;
  quote(request: MarketQuoteRequest): Promise<MarketQuoteResponse>;
}

export type MarketProviderErrorCode = "provider_disabled" | "rate_limited" | "missing_data" | "invalid_response" | "provider_failure";

export class MarketProviderError extends Error {
  readonly code: MarketProviderErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: MarketProviderErrorCode,
    message: string,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "MarketProviderError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MarketDisabledProvider implements MarketDataProvider {
  readonly providerID = "market-disabled";
  readonly licenseMode = "market_disabled" as const;

  async bars(_request: MarketBarsRequest): Promise<MarketBarsResponse> {
    throw new MarketProviderError("provider_disabled", "市場データ提供元未設定");
  }

  async quote(_request: MarketQuoteRequest): Promise<MarketQuoteResponse> {
    throw new MarketProviderError("provider_disabled", "市場データ提供元未設定");
  }
}

export async function loadAlignedBars(
  provider: MarketDataProvider,
  security: MarketBarsRequest,
  benchmark: MarketBarsRequest
): Promise<{ security: MarketBarsResponse; benchmark: MarketBarsResponse }> {
  const [securityResponse, benchmarkResponse] = await Promise.all([
    provider.bars(security),
    provider.bars(benchmark)
  ]);
  if (!securityResponse.bars.length || !benchmarkResponse.bars.length) {
    throw new MarketProviderError("missing_data", "Security and benchmark bars are both required");
  }
  if (securityResponse.providerID !== provider.providerID || benchmarkResponse.providerID !== provider.providerID) {
    throw new MarketProviderError("invalid_response", "Provider identity does not match the response");
  }
  return { security: securityResponse, benchmark: benchmarkResponse };
}
