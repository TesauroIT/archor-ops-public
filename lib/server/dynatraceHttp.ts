// Helpers compartidos por los clientes de la Account Management API.

export const ACCOUNT_API_BASE = "https://api.dynatrace.com";
export const TIMEOUT_MS = 20_000;

export async function apiGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${ACCOUNT_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} en ${path}. ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Ejecuta `fn` sobre `items` con un maximo de `limit` en vuelo. Mantiene el
// orden de entrada en el resultado.
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        out[index] = await fn(items[index]);
      }
    })
  );
  return out;
}
