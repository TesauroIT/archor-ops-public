import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DOWNLOAD_SCOPES, DEPLOY_SCOPES, SAAS_SUFFIX } from "@/lib/dynatrace";
import { getServerI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";

export default async function HelpPage() {
  const { dict } = await getServerI18n();
  const t = dict.help;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.conceptsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t.conceptTenant}</p>
            <p>{t.conceptEnv}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.urlTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {interpolate(t.urlSaas, {
                code: "abc12345",
                url: `https://<id>.${SAAS_SUFFIX}`,
              })}
            </p>
            <p>
              {interpolate(t.urlCustom, {
                code: "/e/<id>",
              })}
            </p>
            <p className="text-muted-foreground">
              {interpolate(t.urlTesting, {
                code: "/api/v1/config/clusterversion",
              })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.actionsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">{t.actionBackup}</p>
              <p className="text-muted-foreground">{t.actionBackupDesc}</p>
              <p className="mt-1">{t.actionBackupScopes}</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {DOWNLOAD_SCOPES.map((s) => (
                  <li key={s.scope}>
                    <code className="rounded bg-muted px-1">{s.scope}</code> — {s.description}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-medium">{t.actionDeploy}</p>
              <p className="text-muted-foreground">{t.actionDeployDesc}</p>
              <p className="mt-1">{t.actionDeployScopes}</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {DEPLOY_SCOPES.map((s) => (
                  <li key={s.scope}>
                    <code className="rounded bg-muted px-1">{s.scope}</code> — {s.description}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-muted-foreground">{t.actionScopesNote}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.jobsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{t.jobsDesc1}</p>
            <p>{t.jobsDesc2}</p>
            <p>{t.jobsDesc3}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.gitTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{t.gitDesc}</p>
          </CardContent>
        </Card>

        <p className="text-sm">
          <Link href="/" className="underline">
            &larr; {t.backToHome}
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
