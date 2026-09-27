import * as cheerio from "cheerio";
import { BlockedError, fetchText, HttpError } from "../http";
import { htmlToText, normaliseText } from "../text";
import type { RawDocument, SourceAdapter } from "../types";

const BASE = "https://www.westmorlandandfurness.gov.uk";
const LIST_PATH = "/westmorland-and-furness-council-news";
const ARTICLE_RE = /^\/westmorland-and-furness-council-news\/\d{4}\/[a-z0-9-]+$/;

/** Article URLs on one listing page, in page order. */
export function parseNewsListing(html: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") ?? "").split(/[?#]/)[0];
    if (ARTICLE_RE.test(href)) {
      const url = BASE + href;
      if (!urls.includes(url)) urls.push(url);
    }
  });
  return urls;
}

/** Parse a LocalGov Drupal news article page. */
export function parseNewsArticle(html: string, url: string): RawDocument | null {
  const $ = cheerio.load(html);
  const title =
    normaliseText($("h1.news-article__title, h1").first().text()) ||
    normaliseText($("title").text().replace(/\s*\|\s*Westmorland and Furness Council\s*$/, ""));
  const datetime = $("time[datetime]").first().attr("datetime");
  const bodyHtml = $(".news-article .field--name-body").first().html() ?? $(".field--name-body").first().html();
  if (!title || !bodyHtml) return null;
  const body = htmlToText(bodyHtml);
  if (body.length < 40) return null;
  const published = datetime ? new Date(datetime) : null;
  return {
    externalId: new URL(url).pathname,
    title,
    url,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    docType: "news",
    body,
  };
}

/** Westmorland and Furness Council press releases (public, verified reachable 2026-09-27). */
export const councilNews: SourceAdapter = {
  key: "council-news",
  name: "Westmorland and Furness Council news",
  baseUrl: BASE + LIST_PATH,
  async run(ctx) {
    const pages = Number(process.env.COUNCIL_NEWS_PAGES ?? 8);
    const urls: string[] = [];
    try {
      for (let p = 0; p < pages; p++) {
        const html = await fetchText(`${BASE}${LIST_PATH}${p ? `?page=${p}` : ""}`);
        const found = parseNewsListing(html);
        if (!found.length) break;
        for (const u of found) if (!urls.includes(u)) urls.push(u);
        ctx.log(`  listing page ${p + 1}/${pages}: ${found.length} articles`);
      }
    } catch (err) {
      const status = err instanceof BlockedError || err instanceof HttpError ? err.status : undefined;
      return {
        status: err instanceof BlockedError ? "blocked" : "error",
        httpStatus: status,
        message: (err as Error).message,
        documents: [],
      };
    }

    const documents: RawDocument[] = [];
    let skipped = 0;
    let failed = 0;
    for (const url of urls) {
      if (documents.length >= ctx.limit) break;
      const id = new URL(url).pathname;
      if (ctx.known.has(id) && !ctx.refetch) {
        skipped++;
        continue;
      }
      try {
        const doc = parseNewsArticle(await fetchText(url), url);
        if (doc) documents.push(doc);
        else failed++;
      } catch (err) {
        failed++;
        ctx.log(`  could not read ${url}: ${(err as Error).message}`);
      }
    }
    return {
      status: "ok",
      httpStatus: 200,
      message: `${urls.length} articles listed, ${documents.length} downloaded, ${skipped} already stored, ${failed} unreadable`,
      documents,
    };
  },
};
