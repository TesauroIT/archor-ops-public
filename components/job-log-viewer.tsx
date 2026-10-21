"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Lightbulb, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { explainMonacoErrors, type MonacoErrorAnalysis } from "@/lib/monacoErrors";
import { useI18n } from "@/lib/i18n/context";

// Solo se renderiza el tramo final del log: un deploy --verbose puede generar
// varios MB y re-renderizar el texto completo en cada chunk congela la
// pestaña. El log completo se descarga con el boton.
const TAIL_CHARS = 150_000;

export function JobLogViewer(props: {
  jobId: string;
  command?: string | null;
  errorSummary?: string | null;
  onDone?: (status: "SUCCESS" | "FAILED") => void;
}) {
  // key={jobId}: al cambiar de job se remonta el visor con estado fresco,
  // sin resets sincronos dentro de efectos.
  return <JobLogViewerInner key={props.jobId} {...props} />;
}

function JobLogViewerInner({
  jobId,
  command,
  errorSummary,
  onDone,
}: {
  jobId: string;
  command?: string | null;
  errorSummary?: string | null;
  onDone?: (status: "SUCCESS" | "FAILED") => void;
}) {
  const { dict, f } = useI18n();
  const t = dict.jobLogViewer;
  const fullOutputRef = useRef("");
  const [tail, setTail] = useState("");
  const [totalChars, setTotalChars] = useState(0);
  const [status, setStatus] = useState<"RUNNING" | "SUCCESS" | "FAILED">("RUNNING");
  const [analysis, setAnalysis] = useState<MonacoErrorAnalysis | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.addEventListener("output", (event) => {
      const { chunk } = JSON.parse((event as MessageEvent).data);
      fullOutputRef.current += chunk;
      const full = fullOutputRef.current;
      setTotalChars(full.length);
      setTail(full.length > TAIL_CHARS ? full.slice(-TAIL_CHARS) : full);
    });

    source.addEventListener("done", (event) => {
      const { status: finalStatus } = JSON.parse((event as MessageEvent).data);
      setStatus(finalStatus);
      if (finalStatus === "FAILED") {
        setAnalysis(explainMonacoErrors(fullOutputRef.current));
      }
      onDoneRef.current?.(finalStatus);
      source.close();
    });

    source.addEventListener("error", () => {
      source.close();
    });

    return () => source.close();
  }, [jobId]);

  // Autoscroll al final: el log "avanza" a la vista mientras Monaco trabaja.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [tail]);

  const truncated = totalChars > TAIL_CHARS;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t.log}</span>
        <Badge
          variant={
            status === "SUCCESS" ? "default" : status === "FAILED" ? "destructive" : "secondary"
          }
        >
          {status}
        </Badge>
        {status === "RUNNING" && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t.running}
          </span>
        )}
        <a
          href={`/api/jobs/${jobId}/log`}
          download
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
          title={t.fullDetail}
        >
          <Download className="size-3.5" />
          {t.download}
        </a>
      </div>

      {command && (
        <div className="rounded-md border bg-muted/40 p-2">
          <p className="text-xs font-medium text-muted-foreground">Comando ejecutado</p>
          <code className="block break-all font-mono text-xs">$ {command}</code>
        </div>
      )}

      {status === "FAILED" && errorSummary && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
          <p className="text-xs font-medium text-destructive">{t.failureReason}</p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-destructive">
            {errorSummary}
          </pre>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.fullDetail}
          </p>
        </div>
      )}

      {status === "FAILED" && analysis && analysis.items.length > 0 && (
        <div className="space-y-3 rounded-md border border-blue-500/40 bg-blue-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <Lightbulb className="size-4 text-blue-600" />
            {t.explanationTitle}
          </p>
          {analysis.items.map((item) => (
            <div key={item.title} className="space-y-1 text-xs">
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground">{item.description}</p>
              <p>
                <span className="font-medium">Cómo resolverlo:</span> {item.fix}
              </p>
            </div>
          ))}
          {analysis.excludeTypes.length > 0 && (
            <div className="rounded-md border bg-background/60 p-2 text-xs">
              <span className="font-medium">{t.shortcut}</span>{" "}
              {f(t.shortcutHint, { types: analysis.excludeTypes.join(", ") })}
            </div>
          )}
        </div>
      )}

      {truncated && (
        <p className="text-xs text-muted-foreground">
          {f(t.truncated, { chars: Math.round(TAIL_CHARS / 1000), total: Math.round(totalChars / 1000) })}
        </p>
      )}

      <ScrollArea className="h-64 rounded-md border bg-black p-3">
        <pre className="whitespace-pre-wrap font-mono text-xs text-green-400">
          {tail || t.waiting}
        </pre>
        <div ref={bottomRef} />
      </ScrollArea>
    </div>
  );
}
