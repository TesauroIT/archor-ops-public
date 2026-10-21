import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/server/settings";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TenantAdmin } from "@/components/settings/tenant-admin";
import { BackupSettingsForm } from "@/components/settings/backup-settings-form";
import { AiAnalysisForm } from "@/components/settings/ai-analysis-form";
import { UsersManager } from "@/components/settings/users-manager";
import { DEFAULT_DASHBOARD_PROMPT } from "@/lib/server/ollama";
import { getServerI18n } from "@/lib/i18n/server";

export default async function SettingsPage() {
  const { dict } = await getServerI18n();
  const [session, settings, tenants, users] = await Promise.all([
    auth(),
    getSettings(),
    prisma.tenant.findMany({
      include: {
        environments: {
          select: { id: true, name: true, slug: true, status: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title={dict.settings.title} description={dict.settings.description} />

        <Tabs defaultValue="clientes">
          <TabsList>
            <TabsTrigger value="clientes">{dict.settings.tabClients}</TabsTrigger>
            <TabsTrigger value="backups">{dict.settings.tabBackups}</TabsTrigger>
            <TabsTrigger value="ia">{dict.settings.tabAi}</TabsTrigger>
            <TabsTrigger value="usuarios">{dict.settings.tabUsers}</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes">
            <TenantAdmin tenants={tenants} />
          </TabsContent>

          <TabsContent value="backups">
            <BackupSettingsForm
              initial={{
                backupRetention: settings.backupRetention,
                autoBackupEnabled: settings.autoBackupEnabled,
                autoBackupIntervalHours: settings.autoBackupIntervalHours,
                lastAutoBackupAt: settings.lastAutoBackupAt?.toISOString() ?? null,
                dpsSnapshotEnabled: settings.dpsSnapshotEnabled,
                dpsSnapshotIntervalHours: settings.dpsSnapshotIntervalHours,
                lastDpsSnapshotAt: settings.lastDpsSnapshotAt?.toISOString() ?? null,
              }}
            />
          </TabsContent>

          <TabsContent value="ia">
            <AiAnalysisForm
              initial={{
                ollamaUrl: settings.ollamaUrl,
                ollamaModel: settings.ollamaModel,
                dashboardPrompt: settings.dashboardPrompt,
              }}
              defaultPrompt={DEFAULT_DASHBOARD_PROMPT}
            />
          </TabsContent>

          <TabsContent value="usuarios">
            <UsersManager
              users={users.map((user) => ({
                ...user,
                createdAt: user.createdAt.toISOString(),
              }))}
              currentEmail={session?.user?.email ?? ""}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
