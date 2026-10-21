import Link from "next/link";
import {
  Activity,
  Bot,
  CheckCircle2,
  Download,
  Gauge,
  LayoutDashboard,
  Lock,
  Rocket,
  Server,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { HeroAnimation } from "@/components/hero-animation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/language-switcher";

// Landing publica que se muestra en "/" cuando no hay sesion iniciada.
// Explica que hace la app y como instalarla; el acceso real sigue en /login.

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/60 px-4 py-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

export async function LandingPage() {
  const { dict } = await getServerI18n();
  const t = dict.landing;

  const features = [
    { icon: Server, title: t.features.clientsTitle, description: t.features.clientsDesc },
    { icon: Download, title: t.features.backupsTitle, description: t.features.backupsDesc },
    { icon: Rocket, title: t.features.promoteTitle, description: t.features.promoteDesc },
    { icon: LayoutDashboard, title: t.features.dashboardsTitle, description: t.features.dashboardsDesc },
    { icon: Gauge, title: t.features.dpsTitle, description: t.features.dpsDesc },
    { icon: Activity, title: t.features.activityTitle, description: t.features.activityDesc },
  ];

  const requirements = [
    t.requirements.node,
    t.requirements.git,
    t.requirements.monaco,
    t.requirements.ollama,
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">Archon Ops</span>
          <div className="flex items-center gap-4">
            <div className="w-32">
              <LanguageSwitcher />
            </div>
            <Link href="/login" className={cn(buttonVariants({ variant: "default" }))}>
              {t.signIn}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-muted/60 to-background">
        <div className="mx-auto max-w-6xl px-6 py-14 text-center">
          <p className="mb-2 text-sm font-medium text-primary">{t.heroKicker}</p>
          <h1 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            {t.heroTitle}
          </h1>

          <div className="mt-8">
            <HeroAnimation labels={dict.heroAnim} />
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">{t.heroSubtitle}</p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
              {t.signIn}
            </Link>
            <a
              href="#instalacion"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              <Terminal className="size-4" />
              {t.howToInstall}
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight">{t.featuresTitle}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <feature.icon className="mb-1 size-6 text-primary" />
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Instalacion */}
      <section id="instalacion" className="border-t bg-muted/30">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">{t.installTitle}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t.installIntro}</p>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">{t.requirementsTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {requirements.map((req) => (
                  <li key={req} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
                    {req}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="mt-8 space-y-8">
            <div className="space-y-3">
              <h3 className="font-medium">{t.step1}</h3>
              <CodeBlock>{`git clone https://github.com/TesauroIT/archor-ops-public.git
cd archor-ops-public
npm install
cp .env.example .env`}</CodeBlock>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">
                {t.step2Prefix} <code className="font-mono text-sm">.env</code>
              </h3>
              <CodeBlock>{`DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="<random-secret>"      # openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"
ENCRYPTION_KEY="<64 hex chars>"        # openssl rand -hex 32
MONACO_BIN_PATH="monaco"
DATA_DIR="./data"
SEED_ADMIN_EMAIL="admin@local"
SEED_ADMIN_PASSWORD="cambia-esta-password"`}</CodeBlock>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">{t.step3}</h3>
              <CodeBlock>{`npx prisma migrate dev
npx prisma db seed`}</CodeBlock>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">{t.step4}</h3>
              <CodeBlock>{`npm run dev
# prod: npm run build && npm run start`}</CodeBlock>
              <p className="text-sm text-muted-foreground">{t.step4Note}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5" />
            {t.footerSecurity}
          </span>
          <span className="flex items-center gap-1.5">
            <Bot className="size-3.5" />
            Archon Ops
          </span>
        </div>
      </footer>
    </div>
  );
}
