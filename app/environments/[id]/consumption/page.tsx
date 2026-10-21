import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsumptionPanel } from "@/components/consumption-panel";
import { UsersPanel } from "@/components/users-panel";
import { GroupsPanel } from "@/components/groups-panel";
import { getServerI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";

export default async function ConsumptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const environment = await prisma.environment.findUnique({
    where: { id },
    include: { tenant: true },
  });
  if (!environment) notFound();

  const { dict } = await getServerI18n();
  const t = dict.consumption;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={interpolate(t.detailTitle, { tenant: environment.tenant.name, name: environment.name })}
          description={t.detailDescription}
          action={
            <Link
              href={`/environments/${environment.id}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <ArrowLeft className="size-4" />
              {t.backToEnv}
            </Link>
          }
        />

        {/* El padron de usuarios vive en su propia pestaña: sale de otro
            endpoint (IAM) y no tiene por que bloquear el panel de consumo si
            al OAuth client le falta el scope account-idm-read. */}
        <Tabs defaultValue="consumo">
          <TabsList>
            <TabsTrigger value="consumo">{dict.envUsers.tabConsumption}</TabsTrigger>
            <TabsTrigger value="usuarios">{dict.envUsers.tabUsers}</TabsTrigger>
            <TabsTrigger value="grupos">{dict.envUsers.tabGroups}</TabsTrigger>
          </TabsList>

          <TabsContent value="consumo">
            <ConsumptionPanel environmentId={environment.id} />
          </TabsContent>

          <TabsContent value="usuarios">
            <UsersPanel environmentId={environment.id} environmentName={environment.slug} />
          </TabsContent>

          <TabsContent value="grupos">
            <GroupsPanel environmentId={environment.id} environmentName={environment.slug} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
