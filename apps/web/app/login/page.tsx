import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Council sign-in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await getSession()) redirect("/council");
  const { expired } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-paper-2 px-4">
      <div className="slab w-full max-w-sm px-6 py-7">
        <Link href="/" className="focus-ring rounded-[2px]">
          <Wordmark className="text-2xl" />
        </Link>
        <h1 className="mt-6 font-display text-2xl font-bold tracking-[-0.012em] [font-stretch:108%]">Council area</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          For officers and members of Westmorland and Furness Council and Kendal Town Council. No password: we email you a link.
        </p>
        <LoginForm expired={expired === "1"} />
      </div>
    </main>
  );
}
