import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { DashboardsManager } from "@/components/dashboards-manager";
import { getServerI18n } from "@/lib/i18n/server";

export default async function DashboardsPage() {
  const { dict } = await getServerI18n();
  const t = dict.dashboards;

  const environments = await prisma.environment.findMany({
    include: { tenant: true },
    orderBy: [{ tenant: { name: "asc" } }, { name: "asc" }],
  });

  const options = environments.map((env) => ({
    id: env.id,
    label: `${env.tenant.name} / ${env.name}`,
    hasPlatformToken: !!env.platformTokenCipher,
    dtEnvId: env.envId,
  }));

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
        />
        <DashboardsManager environments={options} />
      </div>
    </AppShell>
  );
}
