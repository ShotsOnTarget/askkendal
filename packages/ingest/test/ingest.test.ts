import { describe, expect, it } from "vitest";
import { Geocoder } from "../src/geocode";
import { isChallenge } from "../src/http";
import { isPublicDocument } from "../src/publicity";
import { parseNewsArticle, parseNewsListing } from "../src/sources/council-news";
import { classify } from "../src/sources/ea-flood";
import { parseTownCouncilNews, wpItemToDocument } from "../src/sources/town-council";
import { htmlToText, summarise } from "../src/text";

// Synthetic pages that mirror the structure of the live sites (not copies of real articles).
const LISTING = `
<main>
  <a href="/westmorland-and-furness-council-news/2026/new-bridge-opens-example">New bridge</a>
  <a href="/westmorland-and-furness-council-news/2026/new-bridge-opens-example?utm=x">dup</a>
  <a href="/westmorland-and-furness-council-news/2026/library-hours-example">Library</a>
  <a href="/westmorland-and-furness-council-news?page=2">next</a>
  <a href="/your-council">nav</a>
</main>`;

const ARTICLE = `
<html><head><title>Example headline | Westmorland and Furness Council</title></head><body>
<article class="news-article node">
  <h1 class="news-article__title">Example headline about Highgate</h1>
  <div class="news-article__metadata"><time datetime="2026-09-25" class="news-article__metadata-item--date">25 September 2026</time></div>
  <div class="news-article__content node__content">
    <div class="field field--name-body"><p>The council has approved resurfacing on Highgate in Kendal.&nbsp;</p><p>Work starts in October.</p><ul><li>Night work</li><li>Diversions signed</li></ul></div>
  </div>
</article></body></html>`;

describe("council news parser", () => {
  it("finds article links once each, ignoring navigation", () => {
    expect(parseNewsListing(LISTING)).toEqual([
      "https://www.westmorlandandfurness.gov.uk/westmorland-and-furness-council-news/2026/new-bridge-opens-example",
      "https://www.westmorlandandfurness.gov.uk/westmorland-and-furness-council-news/2026/library-hours-example",
    ]);
  });

  it("extracts title, date and body text", () => {
    const url = "https://www.westmorlandandfurness.gov.uk/westmorland-and-furness-council-news/2026/x";
    const doc = parseNewsArticle(ARTICLE, url)!;
    expect(doc.title).toBe("Example headline about Highgate");
    expect(doc.publishedAt?.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(doc.externalId).toBe("/westmorland-and-furness-council-news/2026/x");
    expect(doc.body).toContain("The council has approved resurfacing on Highgate in Kendal.");
    expect(doc.body).toContain("• Night work");
    expect(doc.body).not.toMatch(/&nbsp;/);
  });

  it("returns null for pages without an article body", () => {
    expect(parseNewsArticle("<html><h1>Menu</h1></html>", "https://www.westmorlandandfurness.gov.uk/a")).toBeNull();
  });
});

describe("town council parser", () => {
  it("keeps news slugs and drops policies and previews", () => {
    const html = `
      <a href="https://www.kendaltowncouncil.gov.uk/index.php/kendal-20mph-scheme/">20mph</a>
      <a href="https://www.kendaltowncouncil.gov.uk/index.php/privacy-policy/">Privacy</a>
      <a href="https://www.kendaltowncouncil.gov.uk/index.php/draft-item/?preview=true">Draft</a>
      <a href="https://www.kendaltowncouncil.gov.uk/committees/">Committees</a>`;
    expect(parseTownCouncilNews(html)).toEqual(["kendal-20mph-scheme"]);
  });

  it("converts a WordPress item", () => {
    const doc = wpItemToDocument({
      id: 42,
      date_gmt: "2026-03-01T10:00:00",
      modified_gmt: "2026-03-02T10:00:00",
      link: "https://www.kendaltowncouncil.gov.uk/index.php/example/",
      title: { rendered: "Grants &amp; funding round opens" },
      content: { rendered: "<p>Community groups in Kendal can apply for small grants this spring.</p>" },
    })!;
    expect(doc.title).toBe("Grants & funding round opens");
    expect(doc.externalId).toBe("wp-42");
    expect(doc.publishedAt?.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });
});

describe("geocoder", () => {
  const geo = new Geocoder([
    { name: "Highgate", kind: "street in Kendal", lat: 54.326, lon: -2.747 },
    { name: "Kendal Castle", kind: "historic site", lat: 54.325, lon: -2.736 },
    { name: "Castle Street", kind: "street in Kendal", lat: 54.33, lon: -2.74 },
    { name: "Stricklandgate", kind: "street in Kendal", lat: 54.331, lon: -2.748 },
  ]);

  it("matches whole names, longest first, title mentions ranked first", () => {
    const c = geo.candidates("Works near Kendal Castle", "Highgate and Highgate again. Stricklandgates is not a street. Castle Street too.");
    expect(c.map((x) => x.name)).toEqual(["Kendal Castle", "Highgate", "Castle Street"]);
    expect(c[1].mentions).toBe(2);
  });

  it("finds nothing when no place is named", () => {
    expect(geo.candidates("Council tax", "Bills go out in March.")).toEqual([]);
  });
});

describe("rules", () => {
  it("keeps planning off the public door and respects the privacy judgment", () => {
    expect(isPublicDocument("planning", "planning-list", 0)).toBe(false);
    expect(isPublicDocument("council-news", "news", null)).toBe(true);
    expect(isPublicDocument("council-news", "news", 0.6)).toBe(false);
    expect(isPublicDocument("moderngov", "minutes", null)).toBe(false);
    expect(isPublicDocument("moderngov", "minutes", 0.1)).toBe(true);
  });

  it("recognises bot-protection pages", () => {
    expect(isChallenge(403, "<title>Just a moment...</title>")).toBe(true);
    expect(isChallenge(200, "Just a moment")).toBe(false);
    expect(isChallenge(404, "not found")).toBe(false);
  });

  it("classifies river levels against the typical range", () => {
    expect(classify(0.3, 0.18, 1.2)).toMatchObject({ status: "normal" });
    expect(classify(1.5, 0.18, 1.2).status).toBe("high");
    expect(classify(0.1, 0.18, 1.2).status).toBe("low");
    expect(classify(0.5, null, 1.2).status).toBe("unknown");
  });

  it("turns HTML into readable text and summaries", () => {
    expect(htmlToText("<p>One.</p><p>Two <b>bold</b></p>")).toBe("One.\n\nTwo bold");
    const long = `${"A sentence about the town centre. ".repeat(20)}`;
    expect(summarise(long, 100).endsWith(".")).toBe(true);
  });
});
