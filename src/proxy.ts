import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "./lib/admin";

const AUTH_PAGES = ["/login", "/signup"];
// /api/cron/* has no session: those routes check CRON_SECRET themselves.
const isPublic = (path: string) => path === "/" || AUTH_PAGES.includes(path) || path.startsWith("/auth/") || path.startsWith("/api/cron/");

/**
 * Runs before every page: refreshes the Supabase session cookie, then routes by login state.
 * Signed out → app pages redirect to /login. Signed in → landing/auth pages redirect to /today.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Without Supabase the app runs in local-only mode: no accounts, nothing to guard.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Validates the JWT (and refreshes it if expired). Don't put code between client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const path = request.nextUrl.pathname;

  const redirect = (to: string) => {
    const target = new URL(to, request.url);
    const res = NextResponse.redirect(target);
    // Carry over any refreshed session cookies.
    for (const c of response.cookies.getAll()) res.cookies.set(c);
    return res;
  };

  if (!claims && !isPublic(path)) return redirect(`/login?next=${encodeURIComponent(path)}`);
  if (claims && (path === "/" || AUTH_PAGES.includes(path))) return redirect("/today");
  if (path.startsWith("/admin") && !isAdminEmail(claims?.email as string | undefined)) return redirect("/today");
  return response;
}

export const config = {
  // Skip static files, images, the service worker and the manifest.
  matcher: ["/((?!_next/static|_next/image|sw.js|manifest.webmanifest|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
