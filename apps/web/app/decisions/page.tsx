import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Icon, ThemeTag, UrgencyMeter } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PAGE_SIZE, searchPublic, type Scope } from "@/lib/queries";
import { SOURCE_NAMES, THEME_KEYS, themeColor, themeLabel } from "@/lib/themes";

export const metadata: Metadata = { title: "Decisions" };
export const dynamic = "force-dynamic";

type Search = { q?: string; theme?: string; scope?: string; decisions?: string; page?: string };

function href(base: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/decisions?${s}` : "/decisions";
}

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const scope: Scope = sp.scope === "area" ? "area" : "kendal";
  const page = Math.max(1, Number(sp.page) || 1);
  const theme = sp.theme && THEME_KEYS.includes(sp.theme as never) ? sp.theme : undefined;
  const { data, status } = await searchPublic({ q: sp.q, theme, scope, decisionsOnly: sp.decisions === "1", page });
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const base: Search = { q: sp.q, theme, scope: scope === "area" ? "area" : undefined, decisions: sp.decisions };

  return (
    <div className="paper-grain min-h-dvh">
      <SiteHeader current="/decisions" />
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-x-12 pt-10 lg:grid-cols-[280px_1fr]">
          <div className="lg:sticky lg:top-6 lg:self-start">
            <h1 className="font-display text-4xl font-extrabold leading-[0.95] tracking-[-0.022em] [font-stretch:118%]">
              What’s been decided
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Council news and decisions about Kendal, newest first. Search works without AI, so this page keeps working whatever the budget.
            </p>

            <form action="/decisions" className="mt-6" role="search">
              <label htmlFor="q" className="font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">
                Search
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="q"
                  name="q"
                  defaultValue={sp.q ?? ""}
                  placeholder="bridge, parking, Highgate…"
                  className="focus-ring h-10 min-w-0 flex-1 rounded-[4px] bg-paper px-3 text-[15px] shadow-[inset_0_0_0_1px_oklch(0.25_0.022_255/0.2)] placeholder:text-ink-3"
                />
                {theme && <input type="hidden" name="theme" value={theme} />}
                {scope === "area" && <input type="hidden" name="scope" value="area" />}
                {sp.decisions === "1" && <input type="hidden" name="decisions" value="1" />}
                <button type="submit" className="block-btn block-btn-primary">
                  Go
                </button>
              </div>
            </form>

            <fieldset className="mt-6">
              <legend className="font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">Covering</legend>
              <div className="mt-2 flex gap-1.5">
                <Link href={href(base, { scope: undefined, page: undefined })} aria-pressed={scope === "kendal"} className="block-btn text-sm">
                  Kendal
                </Link>
                <Link href={href(base, { scope: "area", page: undefined })} aria-pressed={scope === "area"} className="block-btn text-sm">
                  Kendal + area-wide
                </Link>
              </div>
              <div className="mt-2">
                <Link
                  href={href(base, { decisions: sp.decisions === "1" ? undefined : "1", page: undefined })}
                  aria-pressed={sp.decisions === "1"}
                  className="block-btn text-sm"
                >
                  Decisions only
                </Link>
              </div>
            </fieldset>

            <nav aria-label="Themes" className="mt-6">
              <p className="font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">Theme</p>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 lg:grid-cols-1">
                <li>
                  <Link href={href(base, { theme: undefined, page: undefined })} aria-current={!theme ? "true" : undefined} className="focus-ring flex items-center gap-2 rounded-[2px] py-1 text-sm text-ink-2 aria-[current=true]:font-bold aria-[current=true]:text-ink">
                    <span className="size-2.5 rounded-[2px] bg-ink/20" aria-hidden="true" />
                    All themes
                  </Link>
                </li>
                {THEME_KEYS.filter((k) => k !== "other").map((k) => (
                  <li key={k}>
                    <Link
                      href={href(base, { theme: k, page: undefined })}
                      aria-current={theme === k ? "true" : undefined}
                      className="focus-ring flex items-center gap-2 rounded-[2px] py-1 text-sm text-ink-2 aria-[current=true]:font-bold aria-[current=true]:text-ink"
                    >
                      <span className="size-2.5 rounded-[2px]" style={{ background: themeColor(k) }} aria-hidden="true" />
                      {themeLabel(k)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <section aria-label="Results" className="mt-10 lg:mt-0">
            {!status.ok && <p className="rounded-[4px] bg-amber/25 px-4 py-3 text-sm font-semibold">{status.message}</p>}
            <p className="border-b border-ink/15 pb-3 text-sm text-ink-3 tabular">
              {data.total.toLocaleString("en-GB")} {data.total === 1 ? "item" : "items"}
              {sp.q ? ` matching “${sp.q}”` : ""}
              {theme ? ` in ${themeLabel(theme)}` : ""}
            </p>
            {data.rows.length === 0 && status.ok && (
              <p className="py-10 text-ink-2">Nothing here yet. Try a wider search or include area-wide items.</p>
            )}
            <ol className="divide-y divide-ink/10">
              {data.rows.map((d) => (
                <li key={d.id} className="grid gap-x-6 py-5 sm:grid-cols-[92px_1fr]">
                  <time className="pt-0.5 text-sm font-semibold text-ink-3 tabular" dateTime={d.publishedAt ?? undefined}>
                    {formatDate(d.publishedAt)}
                  </time>
                  <article>
                    <h2 className="font-display text-[19px] font-bold leading-snug tracking-[-0.01em] [font-stretch:104%]">
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded-[2px] decoration-kendal decoration-2 underline-offset-4 [@media(hover:hover)]:hover:underline">
                        {d.title}
                      </a>
                    </h2>
                    {d.summary && <p className="mt-1.5 max-w-[68ch] text-[15px] leading-relaxed text-ink-2">{d.summary}</p>}
                    <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-3">
                      <ThemeTag theme={d.theme} />
                      <UrgencyMeter value={d.urgency} label={d.urgencyLabel} />
                      <span>{SOURCE_NAMES[d.sourceKey] ?? d.sourceKey}</span>
                      {d.lat !== null && (
                        <Link href={`/?item=${d.id}`} className="focus-ring inline-flex items-center gap-1 rounded-[2px] font-semibold text-kendal-deep underline underline-offset-2">
                          <Icon name="flag" className="size-3.5" /> On the map{d.locationName ? `: ${d.locationName}` : ""}
                        </Link>
                      )}
                    </p>
                  </article>
                </li>
              ))}
            </ol>
            {pages > 1 && (
              <nav aria-label="Pages" className="flex items-center justify-between border-t border-ink/15 pt-4 text-sm">
                {page > 1 ? (
                  <Link className="block-btn" href={href(base, { page: String(page - 1) })}>
                    Newer
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-ink-3 tabular">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link className="block-btn" href={href(base, { page: String(page + 1) })}>
                    Older
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
