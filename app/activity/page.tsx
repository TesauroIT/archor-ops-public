import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AgentMonitor } from "@/components/agent-monitor";
import { listActivities } from "@/lib/server/activity";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getServerI18n } from "@/lib/i18n/server";

function formatActivityDetail(message: string, type: string, routePrefix: string) {
  if (!message) return "—";
  if (type === "NAVIGATION") {
    return message.replace(/^.*abrió la ruta /i, routePrefix);
  }
  return message;
}

export default async function ActivityPage() {
  const { locale, dict } = await getServerI18n();
  const t = dict.activity;
  const activities = await listActivities(100);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title={t.title} description={t.description} />

        <AgentMonitor />

        <Card>
          <CardContent>
            <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colClientEnv}</TableHead>
              <TableHead>{t.colAction}</TableHead>
              <TableHead>{t.colStatus}</TableHead>
              <TableHead>{t.colDetail}</TableHead>
              <TableHead>{t.colUser}</TableHead>
              <TableHead>{t.colDate}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((activity) => (
              <TableRow key={activity.id}>
                <TableCell>
                  {activity.environment ? (
                    <Link href={`/environments/${activity.environment.id}`} className="hover:underline">
                      {activity.environment.tenant.name} / {activity.environment.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t.noEnv}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{activity.title}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {(t.types as Record<string, string>)[activity.type] ?? activity.type}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      activity.status === "SUCCESS"
                        ? "default"
                        : activity.status === "FAILED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {activity.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs">
                  <span className="line-clamp-2 text-xs text-muted-foreground" title={activity.message}>
                    {formatActivityDetail(activity.message, activity.type, t.routePrefix)}
                  </span>
                </TableCell>
                <TableCell>{activity.triggeredBy}</TableCell>
                <TableCell>{activity.createdAt.toLocaleString(locale)}</TableCell>
              </TableRow>
            ))}
            {activities.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  {t.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
