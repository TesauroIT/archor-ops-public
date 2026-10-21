import Link from "next/link";
import { Gauge, Settings, Cloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getServerI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";

interface EnvironmentSummary {
  id: string;
  name: string;
  slug: string;
  status: "IDLE" | "RUNNING";
  lastBackupAt: Date | null;
}

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  environments: EnvironmentSummary[];
}

// Vista operativa de solo lectura: muestra lo que ya esta configurado.
// El alta/edicion de clientes y entornos vive en Configuracion > Clientes.
export async function TenantList({ tenants }: { tenants: TenantSummary[] }) {
  const { locale, dict } = await getServerI18n();
  const t = dict.clients;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        description={t.description}
        action={
          <Link href="/settings" className={cn(buttonVariants({ variant: "outline" }))}>
            <Settings className="size-4" />
            {t.configButton}
          </Link>
        }
      />

      {tenants.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t.emptyBefore}{" "}
          <Link href="/settings" className="underline">
            {t.emptyLink}
          </Link>
          .
        </p>
      )}

      <div className="grid gap-4">
        {tenants.map((tenant) => (
          <Card key={tenant.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl font-bold">{tenant.name}</CardTitle>
                <Badge variant="secondary" className="font-normal text-muted-foreground bg-muted/60">
                  {interpolate(t.envCount, { count: tenant.environments.length })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {tenant.environments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noEnvs}</p>
              ) : (
                <ul className="space-y-2">
                  {tenant.environments.map((env) => (
                    <li key={env.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:bg-muted/30">
                      <div>
                        <span className="block font-semibold text-foreground">{env.name}</span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {env.lastBackupAt
                            ? interpolate(t.lastBackup, {
                                date: env.lastBackupAt.toLocaleString(locale),
                              })
                            : t.noBackups}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <Badge variant={env.status === "RUNNING" ? "default" : "secondary"}>
                          {env.status}
                        </Badge>
                        <Link
                          href={`/environments/${env.id}`}
                          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
                        >
                          <Cloud className="size-3.5" />
                          {t.backup || "Backup"}
                        </Link>
                        <Link
                          href={`/environments/${env.id}/consumption`}
                          title={t.consumoTitle}
                          className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 gap-1.5"
                          )}
                        >
                          <Gauge className="size-3.5" />
                          {t.consumo}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
