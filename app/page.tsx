import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { LandingPage } from "@/components/landing-page";
import { TenantList } from "@/components/tenant-list";

export default async function Home() {
  // Sin sesion, "/" muestra la landing publica (el proxy la deja pasar);
  // con sesion, la vista operativa de Clientes de siempre.
  const session = await auth();
  if (!session?.user) return <LandingPage />;

  const tenants = await prisma.tenant.findMany({
    include: {
      environments: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          // Ultimo backup exitoso, para mostrar que tan al dia esta cada entorno.
          jobs: {
            where: { type: "BACKUP", status: "SUCCESS" },
            orderBy: { finishedAt: "desc" },
            take: 1,
            select: { finishedAt: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const view = tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    environments: tenant.environments.map((env) => ({
      id: env.id,
      name: env.name,
      slug: env.slug,
      status: env.status,
      lastBackupAt: env.jobs[0]?.finishedAt ?? null,
    })),
  }));

  return (
    <AppShell>
      <TenantList tenants={view} />
    </AppShell>
  );
}
