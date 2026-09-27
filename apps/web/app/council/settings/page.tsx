import { describeAiSetup } from "@askkendal/ai";
import type { Metadata } from "next";
import { formatDate, formatTime } from "@/lib/format";
import { councilSources, judgmentUsage } from "@/lib/queries";

export const metadata: Metadata = { title: "Sources and AI" };

export default async function CouncilSettings() {
  const ai = describeAiSetup();
  const [{ data: sources }, { data: usage }] = await Promise.all([councilSources(), judgmentUsage(14)]);
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = usage.byDay.find((d) => d.day === today)?.tokens ?? 0;
  const cap = ai.dailyTokenCap;
  const price = ai.pricePerMTok;
  const money = (tokens: number) => (price ? `$${((tokens / 1e6) * price).toFixed(2)}` : null);
  const maxDay = Math.max(1, ...usage.byDay.map((d) => d.tokens));

  return (
    <main className="px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-bold tracking-[-0.02em] [font-stretch:108%]">Sources and AI</h1>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-[8px] bg-paper p-5 shadow-[0_1px_3px_oklch(0.25_0.022_255/0.12)]">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-3">Judgments</h2>
          <p className="mt-2 text-lg font-semibold">{ai.judgments.active ? `TypeSafe ${ai.judgments.model}` : "Off"}</p>
          <p className="mt-1 text-sm text-ink-2">
            {ai.judgments.active ? "Sorts every document: theme, Kendal relevance, impact, decision, privacy, location." : ai.judgments.reason}
          </p>
        </div>
        <div className="rounded-[8px] bg-paper p-5 shadow-[0_1px_3px_oklch(0.25_0.022_255/0.12)]">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-3">Today’s AI use</h2>
          <p className="mt-2 text-lg font-semibold tabular">
            {usedToday.toLocaleString("en-GB")} {cap ? `of ${cap.toLocaleString("en-GB")}` : ""} tokens
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-[2px] bg-paper-3" aria-hidden="true">
            <div className="h-full bg-kendal" style={{ width: `${cap ? Math.min(100, (usedToday / cap) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {money(usedToday) ? `About ${money(usedToday)} today. ` : "Set TYPESAFE_PRICE_PER_MTOK to show cost. "}
            Over the cap, new items are filed by keyword rules.
          </p>
        </div>
        <div className="rounded-[8px] bg-paper p-5 shadow-[0_1px_3px_oklch(0.25_0.022_255/0.12)]">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-3">All time</h2>
          <p className="mt-2 text-lg font-semibold tabular">
            {usage.totals.requests.toLocaleString("en-GB")} requests · {usage.totals.tokens.toLocaleString("en-GB")} tokens
          </p>
          <p className="mt-1 text-sm text-ink-2 tabular">
            {usage.judged} documents judged by Jev, {usage.rules} by rules. Repeat questions are answered from the cache at no cost.
            {money(usage.totals.tokens) ? ` Total about ${money(usage.totals.tokens)}.` : ""}
          </p>
        </div>
      </section>

      <section className="mt-8 rounded-[8px] bg-paper p-5 shadow-[0_1px_3px_oklch(0.25_0.022_255/0.12)]">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-3">Tokens per day, last 14 days</h2>
        {usage.byDay.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">No AI use recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {usage.byDay.map((d) => (
              <li key={d.day} className="grid grid-cols-[88px_1fr_120px] items-center gap-3 text-sm">
                <span className="tabular text-ink-3">{formatDate(d.day)}</span>
                <span className="h-3 rounded-[2px] bg-kendal/80" style={{ width: `${Math.max(2, (d.tokens / maxDay) * 100)}%` }} aria-hidden="true" />
                <span className="text-right tabular">{d.tokens.toLocaleString("en-GB")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-3">Sources</h2>
        <div className="mt-3 overflow-x-auto rounded-[8px] bg-paper shadow-[0_1px_3px_oklch(0.25_0.022_255/0.12)]">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-ink/10 text-xs uppercase tracking-[0.06em] text-ink-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Last run</th>
                <th className="px-3 py-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8">
              {sources.map((s) => (
                <tr key={s.key} className="align-top">
                  <td className="px-4 py-3">
                    <a className="font-semibold underline decoration-ink/20 underline-offset-2 focus-ring" href={s.baseUrl} target="_blank" rel="noopener noreferrer">
                      {s.name}
                    </a>
                    <div className="text-xs text-ink-3 tabular">{s.documentsSeen} documents</div>
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {s.status}
                    {s.lastHttpStatus ? <span className="font-normal text-ink-3"> · HTTP {s.lastHttpStatus}</span> : null}
                  </td>
                  <td className="px-3 py-3 tabular text-ink-2">{s.lastRunAt ? `${formatDate(s.lastRunAt)} ${formatTime(s.lastRunAt)}` : "Never"}</td>
                  <td className="max-w-[48ch] px-3 py-3 text-ink-2">{s.lastMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Run <code className="rounded-[2px] bg-paper-3 px-1">pnpm ingest</code> to refresh all sources, or{" "}
          <code className="rounded-[2px] bg-paper-3 px-1">pnpm ingest --rejudge</code> to send rule-filed items to Jev.
        </p>
      </section>
    </main>
  );
}
