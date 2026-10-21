import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { ConsumptionOverview } from "@/components/consumption-overview";
import { getServerI18n } from "@/lib/i18n/server";

export default async function ConsumptionOverviewPage() {
  const { dict } = await getServerI18n();
  const t = dict.consumption;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.overviewTitle}
          description={t.overviewDescription}
        />
        <ConsumptionOverview />
      </div>
    </AppShell>
  );
}
