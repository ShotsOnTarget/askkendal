import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

/** Convert an HTML fragment to readable plain text with paragraph breaks. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $("#__root");
  root.find("script, style, noscript, iframe, form, figure img").remove();
  root.find("br").replaceWith("\n");
  root.find("p, h1, h2, h3, h4, h5, h6, li, blockquote, tr, div").each((_, el) => {
    $(el).append("\n\n");
  });
  root.find("li").each((_, el) => {
    $(el).prepend("• ");
  });
  return normaliseText(root.text());
}

export function normaliseText(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First paragraph, trimmed to a sentence boundary near `max` characters. */
export function summarise(text: string, max = 280): string {
  const first = text.split(/\n\n/).find((p) => p.trim().length > 40) ?? text;
  if (first.length <= max) return first.trim();
  const cut = first.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, "")}…`).trim();
}

export function contentHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/** Decode the few HTML entities WordPress leaves in titles. */
export function decodeEntities(s: string): string {
  return cheerio.load(`<p>${s}</p>`)("p").text();
}
