import Link from "next/link";
import { Wordmark } from "./ui";

const LINKS = [
  { href: "/", label: "Map" },
  { href: "/decisions", label: "Decisions" },
  { href: "/about", label: "About" },
];

export function SiteHeader({ current }: { current: string }) {
  return (
    <header className="border-b border-ink/10 bg-paper/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="focus-ring rounded-[2px]">
          <Wordmark className="text-2xl" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm font-semibold">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
              className="focus-ring rounded-[4px] px-3 py-2 text-ink-2 aria-[current=page]:bg-ink aria-[current=page]:text-paper [@media(hover:hover)]:hover:bg-paper-2 aria-[current=page]:[@media(hover:hover)]:hover:bg-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-ink/10">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-xs leading-relaxed text-ink-3 sm:grid-cols-[2fr_1fr] sm:px-6">
        <p>
          AskKendal gathers public information from Westmorland and Furness Council and Kendal Town Council. It is an independent project, not a council
          service. Map data © OpenStreetMap contributors (ODbL). River data from the Environment Agency (Open Government Licence). Items are sorted by Jev,
          an AI model from TypeSafe, and the sorting can be wrong: the original document is always the record.
        </p>
        <p className="sm:text-right">
          <Link href="/council" className="focus-ring rounded-[2px] font-semibold text-ink-2 underline underline-offset-2">
            Council sign-in
          </Link>
        </p>
      </div>
    </footer>
  );
}
