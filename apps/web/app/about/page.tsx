import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { formatDate } from "@/lib/format";
import { councilSources } from "@/lib/queries";

export const metadata: Metadata = { title: "About" };
export const dynamic = "force-dynamic";

const STATUS_WORDS: Record<string, { text: string; tone: string }> = {
  ok: { text: "Working", tone: "bg-kendal-soft text-kendal-deep" },
  blocked: { text: "Blocked", tone: "bg-amber/30 text-ink" },
  error: { text: "Failing", tone: "bg-alert/15 text-alert" },
  stub: { text: "Not built yet", tone: "bg-paper-3 text-ink-2" },
  "never-run": { text: "Not run yet", tone: "bg-paper-3 text-ink-2" },
};

export default async function AboutPage() {
  const { data: sources } = await councilSources();
  const contact = process.env.NEXT_PUBLIC_CONTACT_URL;
  return (
    <div className="paper-grain min-h-dvh">
      <SiteHeader current="/about" />
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 pt-12 lg:grid-cols-[1fr_320px]">
          <article className="max-w-[66ch]">
            <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-[-0.022em] [font-stretch:120%]">
              Kendal’s decisions, in one place.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-ink-2">
              The councils that run Kendal publish a lot: news, decisions, committee papers, plans. It is all public, and it is scattered. AskKendal pulls it
              together, sorts it, and puts it on a model of the town so anyone can see what is happening near them.
            </p>

            <h2 className="mt-12 font-display text-2xl font-bold tracking-[-0.012em] [font-stretch:110%]">Who it is for</h2>
            <p className="mt-3 leading-relaxed">
              Everyone with Kendal’s interests at heart: residents, businesses, councillors, community groups and local reporters. Council officers get a
              separate area with extra tools, which is also how the project hopes to pay its way.
            </p>

            <h2 className="mt-10 font-display text-2xl font-bold tracking-[-0.012em] [font-stretch:110%]">How the AI is used</h2>
            <p className="mt-3 leading-relaxed">
              AskKendal does not write anything. Every item links to the council’s own words. An AI model called Jev, from TypeSafe, answers small
              questions about each item: which theme it belongs to, how much it matters to residents, whether it is a decision, where in Kendal it is,
              and whether it names private individuals. Those answers decide how an item is filed and whether it is shown publicly. They can be wrong,
              so the original is always one click away.
            </p>

            <h2 className="mt-10 font-display text-2xl font-bold tracking-[-0.012em] [font-stretch:110%]">What it does not do</h2>
            <ul className="mt-3 space-y-2 leading-relaxed">
              <li>It is not a council service and does not speak for either council.</li>
              <li>It does not predict anything. The model shows what has been published, not what will happen.</li>
              <li>It does not give flood warnings. The river on the model rises within its normal range only. Use the Environment Agency for warnings.</li>
              <li>It does not collect personal data from visitors. There are no accounts on the public site and no tracking.</li>
              <li>Planning applications, which name applicants, are kept out of the public site for now.</li>
            </ul>

            <h2 className="mt-10 font-display text-2xl font-bold tracking-[-0.012em] [font-stretch:110%]">The map</h2>
            <p className="mt-3 leading-relaxed">
              The voxel town is built from OpenStreetMap: every building, road, river and green space, snapped to two-metre blocks. Buildings share one
              height on purpose. It is a picture of Kendal to find your way around, not a survey. If something is missing, it can be fixed on
              OpenStreetMap and will appear here at the next rebuild.
            </p>

            <h2 className="mt-10 font-display text-2xl font-bold tracking-[-0.012em] [font-stretch:110%]">Keeping it running</h2>
            <p className="mt-3 leading-relaxed">
              Hosting is cheap. The AI sorting is the running cost, and it is capped every day so the site never runs up a bill. When the cap is reached,
              new items are filed by simple rules until the next day, and everything else keeps working. AskKendal is looking for sponsors: the
              councils, Kendal Futures, local businesses, or civic technology funds. Sponsors are credited here.
            </p>
            <div className="mt-5 rounded-[4px] bg-paper-2 px-5 py-4">
              <p className="font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">Supported by</p>
              <p className="mt-1 text-ink-2">This space is waiting for its first sponsor.</p>
              {contact && (
                <a href={contact} className="block-btn block-btn-primary focus-ring mt-3">
                  Get in touch
                </a>
              )}
            </div>
          </article>

          <aside className="lg:pt-3">
            <h2 className="font-display text-xs font-bold uppercase tracking-[0.1em] text-ink-3">Where the information comes from</h2>
            <ul className="mt-3 divide-y divide-ink/10">
              {sources.length === 0 && <li className="py-3 text-sm text-ink-2">Source status appears after the first ingestion run.</li>}
              {sources.map((s) => {
                const st = STATUS_WORDS[s.status] ?? STATUS_WORDS["never-run"];
                return (
                  <li key={s.key} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <a href={s.baseUrl} target="_blank" rel="noopener noreferrer" className="focus-ring rounded-[2px] text-sm font-semibold underline decoration-ink/20 underline-offset-2">
                        {s.name}
                      </a>
                      <span className={`shrink-0 rounded-[2px] px-1.5 py-0.5 text-[11px] font-bold ${st.tone}`}>{st.text}</span>
                    </div>
                    {s.lastRunAt && <p className="mt-1 text-xs text-ink-3 tabular">Checked {formatDate(s.lastRunAt)}</p>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-ink-3">
              Committee papers and the Forward Plan sit behind a bot check on the council’s committee website. AskKendal will add them once the council
              allows access or shares an export.
            </p>
            <Link href="/decisions" className="block-btn focus-ring mt-6">
              Browse all decisions
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
