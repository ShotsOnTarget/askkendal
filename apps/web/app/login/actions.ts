"use server";

import { redirect } from "next/navigation";
import { clearSession, createLoginLink, normaliseEmail, sendLoginLink } from "@/lib/auth";

export async function requestLogin(_prev: { sent: boolean; error?: string }, form: FormData) {
  const email = normaliseEmail(String(form.get("email") ?? ""));
  if (!email) return { sent: false, error: "Enter a full email address." };
  try {
    const link = await createLoginLink(email);
    if (link) await sendLoginLink(email, link);
  } catch (err) {
    console.error("[askkendal] login link failed:", (err as Error).message);
    return { sent: false, error: "Sign-in is unavailable right now. Please try again later." };
  }
  // Same answer whether or not the address is allowed, so the form does not reveal who has access.
  return { sent: true };
}

export async function logout() {
  await clearSession();
  redirect("/");
}
