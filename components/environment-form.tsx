"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Server, LayoutDashboard, Mail, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSection } from "@/components/ui/form-section";
import { DOWNLOAD_SCOPES, buildSaasUrl, normalizeEnvId, SAAS_SUFFIX } from "@/lib/dynatrace";
import { useI18n } from "@/lib/i18n/context";

type LocationMode = "saas" | "custom";

export interface EnvironmentFormInitial {
  name: string;
  mode: LocationMode;
  envId: string;
  url: string;
  accountUuid?: string;
  oauthClientId?: string;
}

type TestState = { status: "idle" | "loading" | "ok" | "error"; message?: string };

function TestFeedback({ state }: { state: TestState }) {
  const { dict } = useI18n();
  const t = dict.environmentForm;
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {t.validating}
      </p>
    );
  }
  const ok = state.status === "ok";
  return (
    <p
      className={`flex items-start gap-1.5 text-xs ${
        ok ? "text-green-600 dark:text-green-400" : "text-destructive"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="mt-px size-3.5 shrink-0" />
      ) : (
        <XCircle className="mt-px size-3.5 shrink-0" />
      )}
      <span>{state.message ?? (ok ? t.ok : t.failed)}</span>
    </p>
  );
}

export function EnvironmentForm({
  mode,
  tenantId,
  environmentId,
  initial,
  onSuccess,
}: {
  mode: "create" | "edit";
  tenantId?: string;
  environmentId?: string;
  initial?: EnvironmentFormInitial;
  onSuccess?: () => void;
}) {
  const { dict, f } = useI18n();
  const t = dict.environmentForm;
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [locMode, setLocMode] = useState<LocationMode>(initial?.mode ?? "saas");
  const [envId, setEnvId] = useState(initial?.envId ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [token, setToken] = useState("");
  const [platformToken, setPlatformToken] = useState("");
  const [accountUuid, setAccountUuid] = useState(initial?.accountUuid ?? "");
  const [oauthClientId, setOauthClientId] = useState(initial?.oauthClientId ?? "");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [connTest, setConnTest] = useState<TestState>({ status: "idle" });
  const [platformTest, setPlatformTest] = useState<TestState>({ status: "idle" });
  const [lookupsTest, setLookupsTest] = useState<TestState>({ status: "idle" });
  const [iamTest, setIamTest] = useState<TestState>({ status: "idle" });

  const previewUrl =
    locMode === "saas" && envId.trim() ? buildSaasUrl(normalizeEnvId(envId)) : null;

  function locationPayload() {
    return locMode === "saas"
      ? { mode: "saas" as const, envId }
      : { mode: "custom" as const, url };
  }

  // Ejecuta un POST de validacion y refleja el resultado en el estado dado.
  async function runTest(
    endpoint: string,
    payload: Record<string, unknown>,
    set: (s: TestState) => void
  ) {
    set({ status: "loading" });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data?.error?.formErrors?.[0] ??
          data?.error ??
          t.validationInvalid;
        set({ status: "error", message: typeof msg === "string" ? msg : t.validationInvalid });
        return;
      }
      set({
        status: data.ok ? "ok" : "error",
        message: data.message ?? (data.url ? `${data.message} (${data.url})` : t.validationNoDetails),
      });
    } catch (error) {
      set({ status: "error", message: (error as Error).message });
    }
  }

  async function handleConnTest() {
    // Si se escribio un token nuevo, se prueba ese. Si no y el entorno ya existe,
    // se prueba con lo guardado (token cifrado + ubicacion guardada).
    if (token.trim()) {
      await runTest("/api/dynatrace/test", { ...locationPayload(), token }, setConnTest);
    } else if (mode === "edit" && environmentId) {
      await runTest("/api/dynatrace/test", { environmentId }, setConnTest);
    } else {
      toast.error(t.connTestRequired);
    }
  }

  async function handlePlatformTest() {
    if (platformToken.trim()) {
      await runTest(
        "/api/dynatrace/documents-test",
        { ...locationPayload(), platformToken },
        setPlatformTest
      );
    } else if (mode === "edit" && environmentId) {
      await runTest("/api/dynatrace/documents-test", { environmentId }, setPlatformTest);
    } else {
      toast.error(t.platformTestRequired);
    }
  }

  // Valida los permisos de storage (lookups) del MISMO Platform token.
  async function handleLookupsTest() {
    if (platformToken.trim()) {
      await runTest(
        "/api/dynatrace/lookups-test",
        { ...locationPayload(), platformToken },
        setLookupsTest
      );
    } else if (mode === "edit" && environmentId) {
      await runTest("/api/dynatrace/lookups-test", { environmentId }, setLookupsTest);
    } else {
      toast.error(t.platformTestRequired);
    }
  }

  async function handleIamTest() {
    const overrides: Record<string, unknown> = {};
    if (accountUuid.trim()) overrides.accountUuid = accountUuid;
    if (oauthClientId.trim()) overrides.oauthClientId = oauthClientId;
    if (oauthClientSecret.trim()) overrides.oauthClientSecret = oauthClientSecret;
    if (mode === "edit" && environmentId) overrides.environmentId = environmentId;
    if (Object.keys(overrides).length === 0) {
      toast.error(t.iamTestRequired);
      return;
    }
    await runTest("/api/dynatrace/iam-test", overrides, setIamTest);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const platform = platformToken.trim() ? { platformToken: platformToken.trim() } : {};
      const iam = {
        accountUuid,
        oauthClientId,
        ...(oauthClientSecret.trim() ? { oauthClientSecret: oauthClientSecret.trim() } : {}),
      };
      const payload =
        mode === "create"
          ? { tenantId, name, token, ...platform, ...iam, ...locationPayload() }
          : { name, ...(token.trim() ? { token } : {}), ...platform, ...iam, ...locationPayload() };

      const res =
        mode === "create"
          ? await fetch("/api/environments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/environments/${environmentId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const fieldErr =
          data?.error?.fieldErrors &&
          Object.values(data.error.fieldErrors).flat().filter(Boolean)[0];
        toast.error(fieldErr ?? data?.error?.formErrors?.[0] ?? t.saveError);
        return;
      }

      toast.success(mode === "create" ? t.saveSuccessCreate : t.saveSuccessEdit);
      onSuccess?.();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Identificacion: nombre + ubicacion, lado a lado en pantallas anchas */}
      <FormSection accent="slate" title={t.identification} description={t.identificationDescription}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="env-name">{t.nameLabel}</Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Prod"
            />
          </div>

          <div className="space-y-2">
            <Label>{t.locationLabel}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={locMode === "saas" ? "default" : "outline"}
                onClick={() => setLocMode("saas")}
              >
                {t.saasMode}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={locMode === "custom" ? "default" : "outline"}
                onClick={() => setLocMode("custom")}
              >
                {t.customMode}
              </Button>
            </div>

            {locMode === "saas" ? (
              <div className="space-y-2">
                <Label htmlFor="env-id">{t.envIdLabel}</Label>
                <Input
                  id="env-id"
                  value={envId}
                  onChange={(e) => setEnvId(e.target.value)}
                  placeholder="abc12345"
                />
                <p className="text-xs text-muted-foreground">
                  {t.envIdHint}{" "}
                  <code className="rounded bg-muted px-1">https://&lt;id&gt;.{SAAS_SUFFIX}</code>
                  {previewUrl && (
                    <>
                      {" "}
                      &rarr; <span className="font-mono">{previewUrl}</span>
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="env-url">{t.envUrlLabel}</Label>
                <Input
                  id="env-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://dynatrace.miempresa.com/e/xxxxxxxx"
                />
                <p className="text-xs text-muted-foreground">
                  {t.envUrlHint}
                </p>
              </div>
            )}
          </div>
        </div>
      </FormSection>

      {/* Secciones de credenciales: grid responsive 1 / 2 / 3 columnas */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Monaco */}
        <FormSection
          accent="blue"
          icon={<Server />}
          title={t.monacoTitle}
          description={t.monacoDescription}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleConnTest}
              disabled={connTest.status === "loading"}
            >
              {t.test}
            </Button>
          }
        >
          <div className="space-y-2">
            <Label htmlFor="env-token">
              {f(t.tokenLabel, { mode: mode === "edit" ? t.keepValue : "" })}
            </Label>
            <Input
              id="env-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required={mode === "create"}
              placeholder={mode === "edit" ? "••••••••" : "dt0c01...."}
            />
          </div>
          <TestFeedback state={connTest} />
          <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            <p className="font-medium">{t.scopesTitle}</p>
            <ul className="mt-1 list-disc pl-4">
              {DOWNLOAD_SCOPES.map((s) => (
                <li key={s.scope}>
                  <code className="rounded bg-muted px-1">{s.scope}</code> — {s.description}
                </li>
              ))}
            </ul>
          </div>
        </FormSection>

        {/* Dashboards / Platform token */}
        <FormSection
          accent="violet"
          icon={<LayoutDashboard />}
          title={t.dashboardsTitle}
          description={t.dashboardsDescription}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePlatformTest}
              disabled={platformTest.status === "loading"}
            >
              {t.test}
            </Button>
          }
        >
          <div className="space-y-2">
            <Label htmlFor="env-platform-token">
              {f(t.platformTokenLabel, { mode: mode === "edit" ? t.keepValue : "" })}
            </Label>
            <Input
              id="env-platform-token"
              type="password"
              value={platformToken}
              onChange={(e) => setPlatformToken(e.target.value)}
              placeholder={mode === "edit" ? "••••••••" : "dt0s16...."}
            />
          </div>
          <TestFeedback state={platformTest} />
          <p className="text-xs text-muted-foreground">
            Dashboards: <code className="rounded bg-muted px-1">document:documents:read</code>,{" "}
            <code className="rounded bg-muted px-1">write</code>,{" "}
            <code className="rounded bg-muted px-1">admin</code>.
          </p>

          {/* El mismo Platform token gestiona lookups (Grail Resource Store) si
              ademas tiene los permisos de storage. Test de permisos separado. */}
          <div className="flex items-center justify-between border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Lookups: <code className="rounded bg-muted px-1">storage:files:read</code>,{" "}
              <code className="rounded bg-muted px-1">write</code>,{" "}
              <code className="rounded bg-muted px-1">delete</code>,{" "}
              <code className="rounded bg-muted px-1">storage:buckets:read</code>.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLookupsTest}
              disabled={lookupsTest.status === "loading"}
            >
              {t.test}
            </Button>
          </div>
          <TestFeedback state={lookupsTest} />
        </FormSection>

        {/* IAM / correos */}
        <FormSection
          accent="amber"
          icon={<Mail />}
          title={t.iamTitle}
          description={t.iamDescription}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleIamTest}
              disabled={iamTest.status === "loading"}
            >
              {t.test}
            </Button>
          }
        >
          <p className="text-xs text-muted-foreground">
            {t.iamIntro}
          </p>
          <div className="space-y-2">
            <Label htmlFor="env-oauth-id">Client ID</Label>
            <Input
              id="env-oauth-id"
              value={oauthClientId}
              onChange={(e) => setOauthClientId(e.target.value)}
              placeholder="dt0s02...."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="env-oauth-secret">
              {f(t.oauthClientSecretLabel, { mode: mode === "edit" ? t.keepValue : "" })}
            </Label>
            <Input
              id="env-oauth-secret"
              type="password"
              value={oauthClientSecret}
              onChange={(e) => setOauthClientSecret(e.target.value)}
              placeholder="dt0s02.XXXX.YYYY..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="env-account-uuid">Dynatrace URN</Label>
            <Input
              id="env-account-uuid"
              value={accountUuid}
              onChange={(e) => setAccountUuid(e.target.value)}
              placeholder="urn:dtaccount:abc12345-...."
            />
            <p className="text-xs text-muted-foreground">
              {t.iamUrnHint}
            </p>
          </div>
          <TestFeedback state={iamTest} />
        </FormSection>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {mode === "create" ? t.saveButton : t.saveButtonEdit}
        </Button>
      </div>
    </form>
  );
}
