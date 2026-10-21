import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { decryptToken, maskToken } from "@/lib/crypto";
import { listCommits } from "@/lib/server/gitRunner";
import { computeBackupSummary } from "@/lib/server/files";
import { AppShell } from "@/components/app-shell";
import { EnvironmentDetail } from "@/components/environment-detail";

export default async function EnvironmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const environment = await prisma.environment.findUnique({
    where: { id },
    include: { tenant: true, jobs: { orderBy: { createdAt: "desc" }, take: 50 } },
  });

  if (!environment) notFound();

  const [commits, summary, allEnvironments] = await Promise.all([
    listCommits(environment.localPath),
    computeBackupSummary(environment.localPath),
    prisma.environment.findMany({
      include: { tenant: true },
      orderBy: [{ tenant: { name: "asc" } }, { name: "asc" }],
    }),
  ]);
  const { stats, configTypes: configStats } = summary;

  const environmentOptions = allEnvironments.map((env) => ({
    id: env.id,
    label: `${env.tenant.name} / ${env.name}`,
  }));

  return (
    <AppShell>
      <EnvironmentDetail
        environment={{
          id: environment.id,
          name: environment.name,
          url: environment.url,
          envId: environment.envId,
          tokenMasked: maskToken(decryptToken(environment.tokenCipher)),
          accountUuid: environment.accountUuid,
          oauthClientId: environment.oauthClientId,
          status: environment.status,
          tenant: { name: environment.tenant.name },
        }}
        jobs={environment.jobs.map((job) => ({
          id: job.id,
          type: job.type,
          dryRun: job.dryRun,
          status: job.status,
          triggeredBy: job.triggeredBy,
          createdAtLabel: job.createdAt.toLocaleString("es-AR"),
          command: job.command,
          errorSummary: job.errorSummary,
          exitCode: job.exitCode,
        }))}
        commits={commits.map((commit) => ({
          ...commit,
          dateLabel: new Date(commit.date).toLocaleString("es-AR"),
        }))}
        stats={stats}
        configStats={configStats}
        environments={environmentOptions}
      />
    </AppShell>
  );
}
