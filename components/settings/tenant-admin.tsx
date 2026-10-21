"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EnvironmentForm } from "@/components/environment-form";
import { EnvEditDialog } from "@/components/env-edit-dialog";
import { useI18n } from "@/lib/i18n/context";

export interface EnvironmentSummary {
  id: string;
  name: string;
  slug: string;
  status: "IDLE" | "RUNNING";
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  environments: EnvironmentSummary[];
}

// Administracion de clientes (tenants) y sus entornos: alta, renombrado,
// eliminacion y edicion de entornos. Vive en Configuracion > Clientes; la
// pagina Clientes solo muestra lo ya configurado.
export function TenantAdmin({ tenants }: { tenants: TenantSummary[] }) {
  const router = useRouter();
  const { dict, f } = useI18n();
  const t = dict.tenantAdmin;
  const [isPending, startTransition] = useTransition();
  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [renameTenantId, setRenameTenantId] = useState<string | null>(null);
  const [newEnvTenantId, setNewEnvTenantId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tenantToDelete, setTenantToDelete] = useState<TenantSummary | null>(null);

  async function createTenant(formData: FormData) {
    const name = formData.get("name") as string;
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error(t.errCreate);
      return;
    }
    toast.success(t.created);
    setNewTenantOpen(false);
    startTransition(() => router.refresh());
  }

  async function renameTenant(tenantId: string, formData: FormData) {
    const name = formData.get("name") as string;
    const res = await fetch(`/api/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error(t.errRename);
      return;
    }
    toast.success(t.updated);
    setRenameTenantId(null);
    startTransition(() => router.refresh());
  }

  async function confirmDeleteTenant() {
    const tenant = tenantToDelete;
    if (!tenant) return;
    setDeletingId(tenant.id);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(t.errDelete);
        return;
      }
      toast.success(t.deleted);
      setTenantToDelete(null);
      startTransition(() => router.refresh());
    } finally {
      setDeletingId(null);
    }
  }

  // Mensaje de confirmación según tenga o no entornos.
  const deleteWarning = tenantToDelete
    ? tenantToDelete.environments.length > 0
      ? f(t.confirmDeleteWithEnvs, { name: tenantToDelete.name, count: tenantToDelete.environments.length })
      : f(t.confirmDelete, { name: tenantToDelete.name })
    : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          <Dialog open={newTenantOpen} onOpenChange={setNewTenantOpen}>
            <DialogTrigger render={<Button>{t.newClient}</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.newClient}</DialogTitle>
                <DialogDescription>{t.newClientDesc}</DialogDescription>
              </DialogHeader>
              <form action={createTenant} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t.clientNameLabel}</Label>
                  <Input id="name" name="name" required placeholder="Acme Corp" />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>
                    {dict.common.create}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {tenants.length === 0 && (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        )}

        {tenants.map((tenant) => (
          <div key={tenant.id} className="space-y-3 rounded-md border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{tenant.name}</p>
                <p className="text-xs text-muted-foreground">
                  {f(t.envCount, { count: tenant.environments.length })}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Dialog
                  open={renameTenantId === tenant.id}
                  onOpenChange={(open) => setRenameTenantId(open ? tenant.id : null)}
                >
                  <DialogTrigger
                    render={
                      <Button variant="ghost" size="sm">
                        {dict.common.rename}
                      </Button>
                    }
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t.renameTitle}</DialogTitle>
                    </DialogHeader>
                    <form action={(fd) => renameTenant(tenant.id, fd)} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor={`rename-${tenant.id}`}>{t.clientNameLabel}</Label>
                        <Input
                          id={`rename-${tenant.id}`}
                          name="name"
                          required
                          defaultValue={tenant.name}
                        />
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={isPending}>
                          {dict.common.save}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={deletingId === tenant.id}
                  onClick={() => setTenantToDelete(tenant)}
                >
                  {dict.common.delete}
                </Button>
              </div>
            </div>

            <ul className="space-y-2">
              {tenant.environments.map((env) => (
                <li
                  key={env.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {env.name}
                    <Badge variant={env.status === "RUNNING" ? "default" : "secondary"}>
                      {env.status}
                    </Badge>
                  </span>
                  <EnvEditDialog environmentId={env.id} />
                </li>
              ))}
            </ul>

            <Dialog
              open={newEnvTenantId === tenant.id}
              onOpenChange={(open) => setNewEnvTenantId(open ? tenant.id : null)}
            >
              <DialogTrigger
                render={
                  <Button variant="outline" size="sm" className="w-full">
                    {t.newEnv}
                  </Button>
                }
              />
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>{f(t.newEnvTitle, { name: tenant.name })}</DialogTitle>
                  <DialogDescription>{t.newEnvDesc}</DialogDescription>
                </DialogHeader>
                <EnvironmentForm
                  mode="create"
                  tenantId={tenant.id}
                  onSuccess={() => setNewEnvTenantId(null)}
                />
              </DialogContent>
            </Dialog>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!tenantToDelete} onOpenChange={(open) => !open && setTenantToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.common.delete}</DialogTitle>
            <DialogDescription>{deleteWarning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTenantToDelete(null)}>
              {dict.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeleteTenant()}
              disabled={!!deletingId}
            >
              {dict.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
