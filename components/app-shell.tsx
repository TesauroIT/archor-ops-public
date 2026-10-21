import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { NavLinks } from "@/components/nav-links";
import { RouteActivityLogger } from "@/components/route-activity-logger";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getServerI18n } from "@/lib/i18n/server";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const { dict } = await getServerI18n();

  return (
    <div className="flex min-h-screen bg-muted/20">
      <RouteActivityLogger />
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-background">
        <div className="px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">Archon Ops</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <NavLinks />
        </div>
        <div className="space-y-2 border-t px-4 py-3">
          <LanguageSwitcher />
          {session?.user?.email && (
            <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
          )}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="outline" size="sm" type="submit" className="w-full">
              {dict.appShell.signOut}
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
