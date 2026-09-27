import { NextResponse, type NextRequest } from "next/server";
import { redeemToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const session = token ? await redeemToken(token).catch(() => null) : null;
  return NextResponse.redirect(new URL(session ? "/council" : "/login?expired=1", req.url));
}
