import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { LookupsManager } from "@/components/lookups-manager";
import { getServerI18n } from "@/lib/i18n/server";

export default async function LookupsPage() {
  const { dict } = await getServerI18n();
  const t = dict.lookups;

  const environments = await prisma.environment.findMany({
    include: { tenant: true },
    orderBy: [{ tenant: { name: "asc" } }, { name: "asc" }],
  });

  const options = environments.map((env) => ({
    id: env.id,
    label: `${env.tenant.name} / ${env.name}`,
    hasPlatformToken: !!env.platformTokenCipher,
  }));

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
        />
        <LookupsManager environments={options} />
      </div>
    </AppShell>
  );
}
