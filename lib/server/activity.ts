import { prisma } from "@/lib/prisma";

export async function logActivity({
  type,
  title,
  message,
  environmentId,
  triggeredBy = "unknown",
  status = "SUCCESS",
}: {
  type: string;
  title: string;
  message?: string;
  environmentId?: string | null;
  triggeredBy?: string;
  status?: string;
}) {
  return prisma.activityLog.create({
    data: {
      type,
      title,
      message: message ?? "",
      status,
      triggeredBy,
      environmentId: environmentId ?? null,
    },
  });
}

export async function listActivities(limit = 100) {
  return prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { environment: { include: { tenant: true } } },
  });
}
