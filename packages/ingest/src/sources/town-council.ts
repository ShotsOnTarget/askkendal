import * as cheerio from "cheerio";
import { BlockedError, fetchJson, fetchText, HttpError } from "../http";
import { decodeEntities, htmlToText } from "../text";
import type { RawDocument, SourceAdapter } from "../types";

const BASE = "https://www.kendaltowncouncil.gov.uk";
const SKIP = /privacy-policy|accessibility-policy|cookie/;

interface WpItem {
  id: number;
  date_gmt: string;
  modified_gmt: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

/** News item slugs linked from the town council's /news/ page. */
export function parseTownCouncilNews(html: string): string[] {
  const $ = cheerio.load(html);
  const slugs: string[] = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (href.includes("?")) return; // drafts and previews
    const m = href.match(/^https:\/\/www\.kendaltowncouncil\.gov\.uk\/index\.php\/([a-z0-9-]+)\/?$/);
    if (m && !SKIP.test(m[1]) && !slugs.includes(m[1])) slugs.push(m[1]);
  });
  return slugs;
}

export function wpItemToDocument(item: WpItem): RawDocument | null {
  const body = htmlToText(item.content.rendered);
  const title = decodeEntities(item.title.rendered).trim();
  if (!title || body.length < 40) return null;
  const published = new Date(`${item.date_gmt}Z`);
  return {
    externalId: `wp-${item.id}`,
    title,
    url: item.link,
    publishedAt: Number.isNaN(published.getTime()) ? null : published,
    docType: "news",
    body,
  };
}

/** Kendal Town Council news, read through the site's public WordPress API. */
export const townCouncil: SourceAdapter = {
  key: "town-council",
  name: "Kendal Town Council news",
  baseUrl: `${BASE}/news/`,
  async run(ctx) {
    let slugs: string[];
    try {
      slugs = parseTownCouncilNews(await fetchText(`${BASE}/news/`));
    } catch (err) {
      return {
        status: err instanceof BlockedError ? "blocked" : "error",
        httpStatus: err instanceof BlockedError || err instanceof HttpError ? err.status : undefined,
        message: (err as Error).message,
        documents: [],
      };
    }
    const documents: RawDocument[] = [];
    const fields = "_fields=id,date_gmt,modified_gmt,link,title,content";
    for (const slug of slugs) {
      if (documents.length >= ctx.limit) break;
      try {
        let items = await fetchJson<WpItem[]>(`${BASE}/wp-json/wp/v2/pages?slug=${slug}&${fields}`);
        if (!items.length) items = await fetchJson<WpItem[]>(`${BASE}/wp-json/wp/v2/posts?slug=${slug}&${fields}`);
        const item = items[0];
        if (!item) continue;
        if (ctx.known.has(`wp-${item.id}`) && !ctx.refetch) continue;
        const doc = wpItemToDocument(item);
        if (doc) documents.push(doc);
      } catch (err) {
        ctx.log(`  could not read ${slug}: ${(err as Error).message}`);
      }
    }
    return {
      status: "ok",
      httpStatus: 200,
      message: `${slugs.length} news items linked, ${documents.length} new or refetched`,
      documents,
    };
  },
};
