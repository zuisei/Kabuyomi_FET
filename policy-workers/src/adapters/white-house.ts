import type { SourceAdapter } from "./types.ts";

export type WhiteHouseItem = { id: string; title: string; url: string; publishedAt: string; modifiedAt?: string };

function decodeEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded.replaceAll("&amp;", "&")
      .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replaceAll("&quot;", "\"").replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
  }
  return decoded;
}

function textBetween(value: string, tag: string): string | null {
  const match = value.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

export class WhiteHouseAdapter implements SourceAdapter<WhiteHouseItem> {
  readonly code = "white-house";
  readonly displayName = "The White House";
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) { this.fetcher = fetcher; }

  async discover(limit: number): Promise<WhiteHouseItem[]> {
    const response = await this.fetcher("https://www.whitehouse.gov/presidential-actions/feed/", { headers: { accept: "application/rss+xml" } });
    if (!response.ok) throw new Error(`White House feed returned HTTP ${response.status}`);
    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit).flatMap((match) => {
      const title = textBetween(match[1], "title");
      const url = textBetween(match[1], "link");
      const guid = textBetween(match[1], "guid") ?? url;
      const pubDate = textBetween(match[1], "pubDate");
      if (!title || !url || !guid || !pubDate) return [];
      return [{ id: guid, title: decodeEntities(title), url, publishedAt: new Date(pubDate).toISOString() }];
    });
    return Promise.all(items.map(async (item) => {
      try {
        const page = await this.fetcher(item.url, { headers: { accept: "text/html", "user-agent": "MarketDocket/0.1 policy-event research" } });
        if (!page.ok) return item;
        const html = await page.text();
        const rawModified = html.match(/<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i)?.[1]
          ?? html.match(/["']dateModified["']\s*:\s*["']([^"']+)["']/i)?.[1];
        const modified = rawModified ? new Date(rawModified) : null;
        return modified && !Number.isNaN(modified.getTime()) && modified.toISOString() > item.publishedAt
          ? { ...item, modifiedAt: modified.toISOString() }
          : item;
      } catch { return item; }
    }));
  }
}
