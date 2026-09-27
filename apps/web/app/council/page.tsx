import type { Metadata } from "next";
import Link from "next/link";
import { ThemeTag, UrgencyMeter } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { councilDocuments, PAGE_SIZE } from "@/lib/queries";
import { SOURCE_NAMES } from "@/lib/themes";

export const metadata: Metadata = { title: "Council documents" };

type Search = { q?: string; source?: string; visibility?: string; page?: string };

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

export default async function CouncilDocuments({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const visibility = sp.visibility === "public" || sp.visibility === "council" ? sp.visibility : undefined;
  const { data, status } = await councilDocuments({ q: sp.q, source: sp.source, visibility, page });
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const qs = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/council?${p}`;
  };

  return (
    <main className="px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-bold tracking-[-0.02em] [font-stretch:108%]">Documents</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
        Everything ingested, most urgent first, including items held back from the public site. Scores come from Jev: impact 0 to 3, the rest are
        probabilities.
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-3" action="/council">
        <label className="text-sm font-semibold">
          Search
          <input name="q" defaultValue={sp.q ?? ""} className="focus-ring mt-1 block h-10 w-64 rounded-[4px] bg-paper px-3 font-normal shadow-[inset_0_0_0_1px_oklch(0.25_0.022_255/0.2)]" />
        </label>
        <label className="text-sm font-semibold">
          Source
          <select name="source" defaultValue={sp.source ?? ""} className="focus-ring mt-1 block h-10 rounded-[4px] bg-paper px-2 font-normal shadow-[inset_0_0_0_1px_oklch(0.25_0.022_255/0.2)]">
            <option value="">All sources</option>
            {Object.entries(SOURCE_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Shown to
          <select name="visibility" defaultValue={visibility ?? ""} className="focus-ring mt-1 block h-10 rounded-[4px] bg-paper px-2 font-normal shadow-[inset_0_0_0_1px_oklch(0.25_0.022_255/0.2)]">
            <option value="">Everyone and council</option>
            <option value="public">Public site</option>
            <option value="council">Council only</option>
          </select>
        </label>
        <button className="block-btn block-btn-primary" type="submit">
          Filter
        </button>
      </form>

      {!status.ok && <p className="mt-6 rounded-[4px] bg-amber/25 px-4 py-3 text-sm font-semibold">{status.message}</p>}

      <div className="mt-6 overflow-x-auto rounded-[8px] bg-paper shadow-[0_1px_3px_oklch(0.25_0.022_255/0.12)]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase tracking-[0.06em] text-ink-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-3 py-3 font-semibold">Impact</th>
              <th className="px-3 py-3 font-semibold" title="How much it is about Kendal, 0 to 3">Kendal</th>
              <th className="px-3 py-3 font-semibold" title="Probability it reports a council decision">Decision</th>
              <th className="px-3 py-3 font-semibold" title="Probability it names private individuals">Names people</th>
              <th className="px-3 py-3 font-semibold">Shown to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/8">
            {data.rows.map((d) => (
              <tr key={d.id} className="align-top">
                <td className="px-4 py-3">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="focus-ring font-semibold underline decoration-ink/20 underline-offset-2">
                    {d.title}
                  </a>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-3">
                    <span className="tabular">{formatDate(d.publishedAt)}</span>
                    <span>{SOURCE_NAMES[d.sourceKey] ?? d.sourceKey}</span>
                    <ThemeTag theme={d.theme} />
                    {d.locationName && <span>Map: {d.locationName}</span>}
                    {d.judgeModel === "rules" && <span className="font-semibold text-amber-deep">Rules only, not yet judged by Jev</span>}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <UrgencyMeter value={d.urgency} label={d.urgencyLabel} />
                </td>
                <td className="px-3 py-3 tabular">{d.kendalRelevance?.toFixed(1) ?? "–"}</td>
                <td className="px-3 py-3 tabular">{pct(d.isDecision)}</td>
                <td className={`px-3 py-3 tabular ${d.namesPrivate !== null && d.namesPrivate >= 0.3 ? "font-bold text-alert" : ""}`}>{pct(d.namesPrivate)}</td>
                <td className="px-3 py-3">{d.isPublic ? "Public" : <span className="font-semibold">Council only</span>}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-2">
                  No documents match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pages" className="mt-4 flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link className="block-btn" href={qs({ page: String(page - 1) })}>
            Previous
          </Link>
        )}
        <span className="text-ink-3 tabular">
          Page {page} of {pages} · {data.total} documents
        </span>
        {page < pages && (
          <Link className="block-btn" href={qs({ page: String(page + 1) })}>
            Next
          </Link>
        )}
      </nav>
    </main>
  );
}
