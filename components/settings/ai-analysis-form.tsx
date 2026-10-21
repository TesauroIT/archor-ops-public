"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";

export interface AiAnalysisSettings {
  ollamaUrl: string;
  ollamaModel: string;
  dashboardPrompt: string | null;
}

export function AiAnalysisForm({
  initial,
  defaultPrompt,
}: {
  initial: AiAnalysisSettings;
  defaultPrompt: string;
}) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.aiSettings;
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState(initial.ollamaUrl);
  const [model, setModel] = useState(initial.ollamaModel);
  // Si no hay prompt custom guardado, arrancamos mostrando el default (editable).
  const [prompt, setPrompt] = useState(initial.dashboardPrompt ?? defaultPrompt);
  const [saving, setSaving] = useState(false);

  const usingDefault = prompt.trim() === defaultPrompt.trim();

  async function save() {
    if (!url.trim()) {
      toast.error(t.errUrl);
      return;
    }
    if (!model.trim()) {
      toast.error(t.errModel);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ollamaUrl: url.trim(),
          ollamaModel: model.trim(),
          // Si coincide con el default, mandamos "" para que el server lo persista
          // como null (seguirá tomando el default del código en el futuro).
          dashboardPrompt: usingDefault ? "" : prompt,
        }),
      });
      if (!res.ok) {
        toast.error(t.errSave);
        return;
      }
      toast.success(t.saved);
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ai-url">{t.urlLabel}</Label>
            <Input
              id="ai-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:11434"
            />
            <p className="text-xs text-muted-foreground">{t.urlHelp}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-model">{t.modelLabel}</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama3.2:3b"
            />
            <p className="text-xs text-muted-foreground">{t.modelHelp}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-prompt">{t.promptLabel}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPrompt(defaultPrompt)}
              disabled={usingDefault}
            >
              {t.resetPrompt}
            </Button>
          </div>
          <textarea
            id="ai-prompt"
            className="min-h-64 w-full rounded-md border bg-transparent p-3 font-mono text-xs"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t.promptHelp}
            {usingDefault && <span className="ml-1">{t.usingDefault}</span>}
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={save} disabled={saving || isPending}>
          {saving ? dict.common.saving : t.saveButton}
        </Button>
      </CardFooter>
    </Card>
  );
}
