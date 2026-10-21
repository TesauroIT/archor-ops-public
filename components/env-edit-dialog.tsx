"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { EnvironmentForm, type EnvironmentFormInitial } from "@/components/environment-form";
import { useI18n } from "@/lib/i18n/context";

// Edicion de un entorno desde cualquier lugar (p.ej. la lista de Clientes),
// sin entrar al detalle. Carga los valores actuales al abrir.
export function EnvEditDialog({ environmentId }: { environmentId: string }) {
  const { dict } = useI18n();
  const t = dict.envEditDialog;
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<EnvironmentFormInitial | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !initial) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/environments/${environmentId}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? t.errorLoad);
          return;
        }
        setInitial({
          name: data.name,
          mode: data.envId ? "saas" : "custom",
          envId: data.envId ?? "",
          url: data.url ?? "",
          accountUuid: data.accountUuid ?? "",
          oauthClientId: data.oauthClientId ?? "",
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            {t.trigger}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {t.description}
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">{t.loading}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {initial && (
          <EnvironmentForm
            mode="edit"
            environmentId={environmentId}
            initial={initial}
            onSuccess={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
