"use client";

import { useActionState } from "react";
import { requestLogin } from "./actions";

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState(requestLogin, { sent: false });
  if (state.sent) {
    return (
      <p role="status" className="mt-6 rounded-[4px] bg-kendal-soft px-4 py-3 text-[15px] leading-relaxed text-kendal-deep">
        If that address has access, a sign-in link is on its way. It works once and expires in 15 minutes.
      </p>
    );
  }
  return (
    <form action={action} className="mt-6">
      {expired && <p className="mb-4 rounded-[4px] bg-amber/25 px-3 py-2 text-sm">That link has expired or was already used. Ask for a new one.</p>}
      <label htmlFor="email" className="text-sm font-semibold">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="focus-ring mt-1.5 h-11 w-full rounded-[4px] bg-paper px-3 text-[15px] shadow-[inset_0_0_0_1px_oklch(0.25_0.022_255/0.25)]"
      />
      {state.error && <p className="mt-2 text-sm font-semibold text-alert">{state.error}</p>}
      <button type="submit" disabled={pending} className="block-btn block-btn-primary mt-4 w-full disabled:opacity-60">
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
