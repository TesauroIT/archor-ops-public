import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isApiRoute = req.nextUrl.pathname.startsWith("/api");
  const isLoginPage = req.nextUrl.pathname === "/login";
  // "/" es publica: sin sesion muestra la landing (app/page.tsx decide).
  const isLanding = req.nextUrl.pathname === "/";

  if (isAuthRoute) return NextResponse.next();

  if (!isLoggedIn && isApiRoute) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!isLoggedIn && !isLoginPage && !isLanding) {
    const loginUrl = new URL("/login", req.nextUrl);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
