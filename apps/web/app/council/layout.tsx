import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

/** The council door: a plain working tool. No game styling here. */
export default async function CouncilLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <div className="min-h-dvh bg-paper-2 lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-ink/10 bg-paper-3/60 lg:min-h-dvh lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block">
          <Link href="/council" className="focus-ring rounded-[2px]">
            <Wordmark className="text-xl" />
            <span className="mt-1 block text-xs font-semibold text-ink-3">Council area</span>
          </Link>
          <nav aria-label="Council" className="flex gap-1 text-sm font-semibold lg:mt-8 lg:flex-col">
            <Link href="/council" className="focus-ring rounded-[4px] px-3 py-2 [@media(hover:hover)]:hover:bg-paper">
              Documents
            </Link>
            <Link href="/council/settings" className="focus-ring rounded-[4px] px-3 py-2 [@media(hover:hover)]:hover:bg-paper">
              Sources and AI
            </Link>
            <Link href="/" className="focus-ring rounded-[4px] px-3 py-2 text-ink-3 [@media(hover:hover)]:hover:bg-paper">
              Public site
            </Link>
            <form action={logout} className="lg:hidden">
              <button type="submit" className="focus-ring rounded-[4px] px-3 py-2 text-ink-3">
                Sign out
              </button>
            </form>
          </nav>
        </div>
        <form action={logout} className="hidden px-5 pb-5 lg:block">
          <p className="truncate text-xs text-ink-3" title={session.email}>
            {session.email}
          </p>
          <button type="submit" className="mt-2 text-xs font-semibold text-ink-2 underline underline-offset-2 focus-ring">
            Sign out
          </button>
        </form>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
