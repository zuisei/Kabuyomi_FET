const aliasGroups = [
  ["btc", "bitcoin", "ビットコイン"],
  ["eth", "ethereum", "イーサリアム"],
  ["ai", "artificial intelligence", "人工知能"],
  ["semiconductor", "semiconductors", "chip", "chips", "半導体"],
  ["sec", "securities and exchange commission", "証券取引委員会"],
  ["tariff", "tariffs", "関税"],
  ["sanction", "sanctions", "制裁"],
  ["inflation", "インフレ"],
  ["whitehouse", "white house", "ホワイトハウス"],
  ["federalregister", "federal register", "連邦官報"]
] as const;

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\-_\/]+/g, " ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const aliasLookup = new Map<string, string[]>();
for (const group of aliasGroups) {
  const normalized = [...new Set(group.map(normalizeSearchText))];
  for (const term of normalized) aliasLookup.set(term, normalized);
}

function alternatives(term: string): string[] {
  return aliasLookup.get(term) ?? [term];
}

export function searchQueryGroups(query: string): string[][] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  if (aliasLookup.has(normalized)) return [alternatives(normalized)];
  return normalized.split(" ").map(alternatives);
}

export function matchesSearchText(searchableText: string, query: string): boolean {
  const groups = searchQueryGroups(query);
  if (groups.length === 0) return true;
  const haystack = normalizeSearchText(searchableText);
  return groups.every((group) => group.some((term) => haystack.includes(term)));
}
