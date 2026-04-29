export function businessContextPattern(): RegExp {
  return /item\s+1\.\s*business|business overview|overview|our business|we are|we provide|we offer|products?|services?|customers?|end markets?|reportable segments?|geograph|revenue by|disaggregation|accelerated computing|artificial intelligence|\bai\b|gpu|graphics|compute|semiconductor|data center|gaming|professional visualization|networking|automotive|cloud service providers?|consumer internet|enterprise|oem/i;
}

export function revenueDriverPattern(): RegExp {
  return /primarily due to|driven by|attributable to|resulted from|because of|reflecting|benefited from|partially offset|offset by|increase(?:d)? due to|decrease(?:d)? due to|higher (?:net )?sales of|lower (?:net )?sales of|sales (?:increase|decrease)|revenue (?:increase|decrease)|net sales (?:increase|decrease)/i;
}

export function riskContextPattern(): RegExp {
  return /item\s+1a|risk factors?|\brisks?\b|uncertain|uncertainty|adverse|depend|competition|competitive|cybersecurity|security vulnerabilities|data breach|privacy|data protection|cloud services?|service outage|third-?party|supply|supplier|regulation|regulatory|antitrust|volatility|tariff|macro|export controls?|customer concentration|demand|inventory|geopolitical|manufacturing|semiconductor|artificial intelligence|\bai\b/i;
}

export function isAccountingEstimateRiskDistractor(text: string): boolean {
  const haystack = text.toLowerCase();
  const accountingSignal =
    /goodwill|impairment|fair value|reporting units?|intangible assets?|annual basis|reassign|carrying value|valuation allowance|future cash flows?|long-term rate of growth|useful lif(?:e|ves)|impairment testing|material adverse effect on fair value/.test(
      haystack
    );
  const realRiskSection = /item\s+1a|risk factors?|business and industry risks|company risks|legal and regulatory risks/.test(haystack);
  return accountingSignal && !realRiskSection;
}
