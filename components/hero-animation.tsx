"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { interpolate } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dict/es";

type HeroLabels = Dictionary["heroAnim"];

// Escena animada del hero de la landing: los entornos de clientes envian su
// configuracion al agente, que la guarda como commits en la boveda de backups.
// Todo en SVG + GSAP, con colores tomados de los tokens del tema (dark mode
// incluido). Si el usuario prefiere movimiento reducido, se muestra el estado
// final estatico sin animar.

const ENVS = [
  { name: "Acme Corp · prod-eu", y: 62, hash: "8006a074" },
  { name: "Banco Sur · prod", y: 170, hash: "b41c92ee" },
  { name: "Retail MX · qa", y: 278, hash: "3f7ad210" },
];

const AGENT = { x: 470, y: 170 };
const VAULT = { x: 700, y: 170 };

export function HeroAnimation({ labels }: { labels: HeroLabels }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const L = labels;
    const q = gsap.utils.selector(svg);
    let backups = 0;

    const setTicker = (text: string) => {
      const el = svg.querySelector<SVGTextElement>("[data-ticker]");
      if (el) el.textContent = text;
    };
    const bumpCounter = () => {
      backups += 1;
      const el = svg.querySelector<SVGTextElement>("[data-counter]");
      if (el) el.textContent = interpolate(L.counter, { count: backups });
    };

    // Estado final estatico para quien prefiere movimiento reducido.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(q("[data-commit]"), { opacity: 1 });
      gsap.set(q("[data-envdot]"), { fill: "#16a34a" });
      setTicker(L.reducedMotion);
      return;
    }

    const ctx = gsap.context(() => {
      // Pulso permanente del anillo del agente.
      gsap.fromTo(
        q("[data-agent-ring]"),
        { scale: 1, opacity: 0.7, transformOrigin: "50% 50%" },
        {
          scale: 1.45,
          opacity: 0,
          duration: 1.6,
          repeat: -1,
          ease: "power1.out",
        }
      );

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2 });

      // Reset al inicio de cada vuelta (los contadores siguen sumando).
      tl.set(q("[data-commit]"), { opacity: 0, x: -8 });
      tl.set(q("[data-envdot]"), { fill: "var(--muted-foreground)" });
      tl.set(q("[data-shield]"), { scale: 1, transformOrigin: "50% 50%" });

      ENVS.forEach((env, i) => {
        const dot = `[data-dot="${i}"]`;

        tl.call(() => setTicker(interpolate(L.backingUp, { name: env.name })));
        // Paquete: entorno -> agente.
        tl.fromTo(
          q(dot),
          { x: 216, y: env.y, opacity: 0, scale: 1 },
          { opacity: 1, duration: 0.15 }
        );
        tl.to(q(dot), {
          x: AGENT.x - 52,
          y: AGENT.y,
          duration: 0.7,
          ease: "power1.inOut",
        });
        // El agente "procesa" (pequeno bump).
        tl.to(q("[data-agent-body]"), {
          scale: 1.08,
          transformOrigin: "50% 50%",
          duration: 0.14,
          yoyo: true,
          repeat: 1,
        });
        // Paquete: agente -> boveda.
        tl.to(q(dot), {
          x: VAULT.x - 8,
          y: VAULT.y,
          duration: 0.6,
          ease: "power1.inOut",
        });
        tl.to(q(dot), { opacity: 0, scale: 0.4, duration: 0.15 });
        // Commit visible en la boveda + entorno marcado en verde + contador.
        tl.call(() => {
          setTicker(interpolate(L.committed, { hash: env.hash }));
          bumpCounter();
        });
        tl.to(q(`[data-commit="${i}"]`), { opacity: 1, x: 0, duration: 0.3 });
        tl.to(q(`[data-envdot="${i}"]`), { fill: "#16a34a", duration: 0.2 }, "<");
        tl.to({}, { duration: 0.35 }); // respiro entre entornos
      });

      // Cierre de la vuelta: escudo.
      tl.call(() => setTicker(L.allProtected));
      tl.fromTo(
        q("[data-shield]"),
        { scale: 1, transformOrigin: "50% 50%" },
        { scale: 1.25, duration: 0.25, yoyo: true, repeat: 1, ease: "power1.inOut" }
      );
    }, svg);

    return () => ctx.revert();
  }, [labels]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 920 360"
      className="mx-auto w-full max-w-4xl"
      role="img"
      aria-label={labels.ariaLabel}
    >
      {/* Conectores */}
      {ENVS.map((env, i) => (
        <line
          key={`in-${i}`}
          x1={216}
          y1={env.y}
          x2={AGENT.x - 54}
          y2={AGENT.y}
          stroke="var(--border)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      ))}
      <line
        x1={AGENT.x + 54}
        y1={AGENT.y}
        x2={VAULT.x - 10}
        y2={VAULT.y}
        stroke="var(--border)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />

      {/* Entornos (clientes) */}
      {ENVS.map((env, i) => (
        <g key={env.name}>
          <rect
            x={16}
            y={env.y - 26}
            width={200}
            height={52}
            rx={10}
            fill="var(--card)"
            stroke="var(--border)"
          />
          <circle data-envdot={i} cx={38} cy={env.y} r={5} fill="var(--muted-foreground)" />
          <text x={52} y={env.y - 2} fontSize={13} fontWeight={600} fill="var(--card-foreground)">
            {env.name.split(" · ")[0]}
          </text>
          <text x={52} y={env.y + 15} fontSize={11.5} fill="var(--muted-foreground)">
            {env.name.split(" · ")[1]} · Dynatrace
          </text>
        </g>
      ))}

      {/* Paquetes que viajan */}
      {ENVS.map((_, i) => (
        <circle key={`dot-${i}`} data-dot={i} cx={0} cy={0} r={5.5} fill="var(--primary)" opacity={0} />
      ))}

      {/* Agente */}
      <g>
        <circle
          data-agent-ring
          cx={AGENT.x}
          cy={AGENT.y}
          r={50}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={1.5}
          opacity={0.5}
        />
        <g data-agent-body>
          <circle cx={AGENT.x} cy={AGENT.y} r={44} fill="var(--card)" stroke="var(--border)" />
          {/* Carita de robot */}
          <line
            x1={AGENT.x}
            y1={AGENT.y - 34}
            x2={AGENT.x}
            y2={AGENT.y - 24}
            stroke="var(--muted-foreground)"
            strokeWidth={2}
          />
          <circle cx={AGENT.x} cy={AGENT.y - 36} r={3} fill="var(--muted-foreground)" />
          <rect
            x={AGENT.x - 22}
            y={AGENT.y - 22}
            width={44}
            height={32}
            rx={8}
            fill="none"
            stroke="var(--card-foreground)"
            strokeWidth={2}
          />
          <circle cx={AGENT.x - 9} cy={AGENT.y - 6} r={3.5} fill="var(--card-foreground)" />
          <circle cx={AGENT.x + 9} cy={AGENT.y - 6} r={3.5} fill="var(--card-foreground)" />
          <text
            x={AGENT.x}
            y={AGENT.y + 30}
            fontSize={12}
            fontWeight={600}
            textAnchor="middle"
            fill="var(--card-foreground)"
          >
            {labels.agent}
          </text>
        </g>
      </g>

      {/* Boveda de backups */}
      <g>
        <rect
          x={VAULT.x}
          y={VAULT.y - 78}
          width={204}
          height={156}
          rx={12}
          fill="var(--card)"
          stroke="var(--border)"
        />
        {/* Escudo */}
        <path
          data-shield
          d={`M ${VAULT.x + 102} ${VAULT.y - 66} l 11 5 v 9 c 0 8 -5 13 -11 16 c -6 -3 -11 -8 -11 -16 v -9 z`}
          fill="none"
          stroke="#16a34a"
          strokeWidth={2}
        />
        <text
          x={VAULT.x + 102}
          y={VAULT.y - 24}
          fontSize={13}
          fontWeight={600}
          textAnchor="middle"
          fill="var(--card-foreground)"
        >
          {labels.vault}
        </text>
        {ENVS.map((env, i) => (
          <text
            key={`commit-${i}`}
            data-commit={i}
            x={VAULT.x + 18}
            y={VAULT.y + 2 + i * 20}
            fontSize={11.5}
            fontFamily="ui-monospace, monospace"
            fill="var(--muted-foreground)"
            opacity={0}
          >
            {interpolate(labels.commitLine, {
              hash: env.hash,
              suffix: env.name.split(" · ")[1],
            })}
          </text>
        ))}
        <text
          data-counter
          x={VAULT.x + 102}
          y={VAULT.y + 68}
          fontSize={11.5}
          fontWeight={600}
          textAnchor="middle"
          fill="var(--card-foreground)"
        >
          {interpolate(labels.counter, { count: 0 })}
        </text>
      </g>

      {/* Ticker de estado */}
      <text
        data-ticker
        x={460}
        y={348}
        fontSize={13}
        textAnchor="middle"
        fill="var(--muted-foreground)"
      >
        {labels.starting}
      </text>
    </svg>
  );
}
