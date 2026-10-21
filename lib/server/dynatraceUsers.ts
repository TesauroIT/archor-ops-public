// Padron de usuarios de la cuenta (Account Management API, scope
// account-idm-read) y las metricas derivadas de la pestaña Usuarios.
//
// El endpoint /iam/v1/accounts/<uuid>/users entrega bastante mas de lo que
// usaba el resumen de consumo: ademas del estado trae userLoginMetadata con
// createdAt, ultimo login exitoso/fallido y contadores acumulados. Por eso
// "usuarios nuevos en la ultima semana" y la actividad salen directo de la
// API, sin tener que inferirlos diffeando snapshots.

import { getAccessToken, type AccountCreds } from "./dynatraceAccount";
import { apiGet } from "./dynatraceHttp";
import {
  emptyGroupsResult,
  fetchGroupsReport,
  type GroupsResult,
} from "./dynatraceGroups";

const ACCOUNT_API_BASE = "https://api.dynatrace.com";
const TIMEOUT_MS = 20_000;

// Ventanas de tiempo (en dias) para altas y actividad. 7 es la que pidio el
// panel ("nuevos en la ultima semana"); 30 y 90 dan contexto alrededor.
export const USER_WINDOWS = [7, 30, 90] as const;
export type UserWindow = (typeof USER_WINDOWS)[number];

export interface AccountUserFull {
  uid: string;
  email: string;
  domain: string;
  name: string | null;
  surname: string | null;
  type: string | null;
  userStatus: string | null;
  emergencyContact: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastSuccessfulLogin: string | null;
  lastFailedLogin: string | null;
  successfulLoginCounter: number | null;
  failedLoginCounter: number | null;
  // Nombres de los grupos IAM a los que pertenece, ordenados alfabeticamente.
  // Vacio si la consulta de grupos fallo (ver UsersReport.groups.error).
  groups: string[];
}

interface RawUser {
  uid?: string;
  email?: string;
  name?: string;
  surname?: string;
  type?: string;
  userStatus?: string;
  emergencyContact?: boolean;
  userLoginMetadata?: {
    createdAt?: string;
    updatedAt?: string;
    lastSuccessfulLogin?: string;
    lastFailedLogin?: string;
    successfulLoginCounter?: number;
    failedLoginCounter?: number;
  };
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}


// Trae el padron completo. La respuesta es { count, items }.
export async function listAccountUsersFull(creds: AccountCreds): Promise<AccountUserFull[]> {
  const token = await getAccessToken(creds, "account-idm-read");
  return listAccountUsersWithToken(token, creds.accountUuid);
}

async function listAccountUsersWithToken(
  token: string,
  accountUuid: string
): Promise<AccountUserFull[]> {
  const data = await apiGet<{ items?: RawUser[]; users?: RawUser[] }>(
    token,
    `/iam/v1/accounts/${encodeURIComponent(accountUuid)}/users`
  );
  const rows = data.items ?? data.users ?? [];
  return rows
    .filter((u): u is RawUser & { uid: string; email: string } => !!u.uid && !!u.email)
    .map((u) => {
      const meta = u.userLoginMetadata ?? {};
      return {
        uid: u.uid,
        email: u.email,
        domain: emailDomain(u.email),
        name: u.name ?? null,
        surname: u.surname ?? null,
        type: u.type ?? null,
        userStatus: u.userStatus ?? null,
        emergencyContact: u.emergencyContact ?? false,
        createdAt: meta.createdAt ?? null,
        updatedAt: meta.updatedAt ?? null,
        lastSuccessfulLogin: meta.lastSuccessfulLogin ?? null,
        lastFailedLogin: meta.lastFailedLogin ?? null,
        successfulLoginCounter: meta.successfulLoginCounter ?? null,
        failedLoginCounter: meta.failedLoginCounter ?? null,
        groups: [],
      };
    });
}

export interface DomainGroup {
  domain: string;
  count: number;
  pct: number; // % del padron
  shared: boolean; // mas de un usuario comparte el dominio
  active: number;
  loggedInRecently: number; // login dentro de la ventana corta (7d)
}

export interface UsersReport {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  // Dominios ordenados por cantidad de usuarios, de mayor a menor.
  domains: DomainGroup[];
  sharedDomains: number; // dominios con 2+ usuarios
  usersInSharedDomains: number;
  singleUserDomains: number;
  // Altas por ventana: { "7": n, "30": n, "90": n }
  newUsers: Record<string, number>;
  // Usuarios sin createdAt (la API no lo informa para invitaciones pendientes).
  withoutCreatedAt: number;
  activity: {
    loggedIn: Record<string, number>; // logins por ventana
    neverLoggedIn: number;
    lastLoginAt: string | null;
    totalSuccessfulLogins: number;
    totalFailedLogins: number;
    usersWithFailedLogins: number;
  };
  // Grupos IAM: filas completas (para la pestaña Grupos) mas el resumen de
  // pertenencia. ok:false => la columna de grupos queda vacia pero el resto
  // del padron se muestra igual. Se omite byEmail porque cada usuario ya
  // lleva sus grupos en `users[].groups`.
  groups: Omit<GroupsResult, "byEmail"> & {
    usersWithoutGroup: number;
    maxPerUser: number;
  };
  users: AccountUserFull[];
}

// byEmail solo sirve para adjuntar los grupos a cada usuario; fuera del
// snapshot seria informacion duplicada.
function withoutByEmail(result: GroupsResult): Omit<GroupsResult, "byEmail"> {
  const { byEmail: _byEmail, ...rest } = result;
  return rest;
}

function countBy<T>(rows: T[], pick: (row: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row) ?? "UNKNOWN";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// Convierte el padron crudo en las metricas del panel. Es una funcion pura:
// se calcula una vez al traer los datos y se persiste junto al snapshot, asi
// la UI no recalcula nada y el historial guardado queda autoexplicativo.
export function buildUsersReport(
  users: AccountUserFull[],
  groupsResult?: GroupsResult,
  now = Date.now()
): UsersReport {
  const DAY = 24 * 60 * 60 * 1000;
  const within = (iso: string | null, days: number) =>
    !!iso && now - new Date(iso).getTime() <= days * DAY;

  const total = users.length;
  const shortWindow = USER_WINDOWS[0];

  // Los grupos se adjuntan a cada usuario antes de calcular nada, asi quedan
  // dentro del snapshot y la UI no tiene que cruzar nada.
  if (groupsResult?.ok) {
    for (const user of users) {
      user.groups = groupsResult.byEmail[user.email.toLowerCase()] ?? [];
    }
  }

  const byDomain = new Map<string, AccountUserFull[]>();
  for (const u of users) {
    const list = byDomain.get(u.domain);
    if (list) list.push(u);
    else byDomain.set(u.domain, [u]);
  }

  const domains: DomainGroup[] = [...byDomain.entries()]
    .map(([domain, list]) => ({
      domain,
      count: list.length,
      pct: total ? (list.length / total) * 100 : 0,
      shared: list.length > 1,
      active: list.filter((u) => u.userStatus?.toUpperCase() === "ACTIVE").length,
      loggedInRecently: list.filter((u) => within(u.lastSuccessfulLogin, shortWindow)).length,
    }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  const newUsers: Record<string, number> = {};
  const loggedIn: Record<string, number> = {};
  for (const days of USER_WINDOWS) {
    newUsers[String(days)] = users.filter((u) => within(u.createdAt, days)).length;
    loggedIn[String(days)] = users.filter((u) => within(u.lastSuccessfulLogin, days)).length;
  }

  const logins = users
    .map((u) => u.lastSuccessfulLogin)
    .filter((v): v is string => !!v)
    .sort();

  return {
    total,
    byStatus: countBy(users, (u) => u.userStatus?.toUpperCase() ?? null),
    byType: countBy(users, (u) => u.type ?? null),
    domains,
    sharedDomains: domains.filter((d) => d.shared).length,
    usersInSharedDomains: domains.filter((d) => d.shared).reduce((a, d) => a + d.count, 0),
    singleUserDomains: domains.filter((d) => !d.shared).length,
    newUsers,
    withoutCreatedAt: users.filter((u) => !u.createdAt).length,
    activity: {
      loggedIn,
      neverLoggedIn: users.filter((u) => !u.lastSuccessfulLogin).length,
      lastLoginAt: logins.at(-1) ?? null,
      totalSuccessfulLogins: users.reduce((a, u) => a + (u.successfulLoginCounter ?? 0), 0),
      totalFailedLogins: users.reduce((a, u) => a + (u.failedLoginCounter ?? 0), 0),
      usersWithFailedLogins: users.filter((u) => (u.failedLoginCounter ?? 0) > 0).length,
    },
    groups: {
      ...withoutByEmail(groupsResult ?? emptyGroupsResult()),
      usersWithoutGroup: groupsResult?.ok
        ? users.filter((u) => u.groups.length === 0).length
        : 0,
      maxPerUser: users.reduce((a, u) => Math.max(a, u.groups.length), 0),
    },
    users,
  };
}

export async function getUsersReport(creds: AccountCreds): Promise<UsersReport> {
  const users = await listAccountUsersFull(creds);
  const emails = new Set(users.map((u) => u.email.toLowerCase()));
  const groups = await fetchGroupsReport(creds, emails);
  return buildUsersReport(users, groups);
}
