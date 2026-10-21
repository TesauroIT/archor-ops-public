// Grupos IAM de la cuenta: miembros y permisos.
//
// La Account API no tiene un endpoint masivo de membresias ni de permisos, asi
// que hay que recorrer grupo por grupo. Se barre por grupo y no por usuario a
// proposito: la cantidad de grupos crece mucho mas despacio que la de
// personas, asi que esto escala mejor en cuentas grandes. Verificado contra la
// via alternativa (GET /users/{email}, que tambien trae groups): coinciden
// exacto.
//
// Por cada grupo se piden miembros y permisos en paralelo; con 6 grupos en
// vuelo el barrido de 75 grupos tarda ~3 s. Se paga una vez por dia, dentro
// del snapshot.

import { getAccessToken, type AccountCreds } from "./dynatraceAccount";
import { apiGet, pool } from "./dynatraceHttp";

const GROUP_CONCURRENCY = 6;

export interface GroupPermission {
  permissionName: string;
  scope: string;
  scopeType: string; // account | tenant | management-zone
}

export interface GroupRow {
  uuid: string;
  name: string;
  description: string | null;
  // LOCAL = creado a mano; SAML = federado desde el IdP; ALL_USERS = el grupo
  // automatico que contiene a toda la cuenta.
  owner: string;
  // Valores del claim del IdP que mapean a este grupo (solo en los SAML).
  federatedValues: string[];
  createdAt: string | null;
  updatedAt: string | null;
  members: number; // todos los emails del grupo
  people: number; // los que estan en el padron de usuarios
  serviceAccounts: number; // los que no (cuentas OAuth de servicio)
  permissions: number;
  scopeTypes: string[];
  permissionNames: string[];
}

export interface GroupsResult {
  ok: boolean;
  error?: string;
  total: number;
  empty: number; // sin ningun miembro
  // Emails en grupos que no estan en el padron: cuentas de servicio OAuth
  // (type SERVICE_EXTERNAL), que GET /users excluye.
  serviceAccounts: number;
  // Señales de higiene para una revision de accesos.
  withoutPermissions: number;
  withPermissionsNoMembers: number;
  onlyServiceAccounts: number;
  permissionsOk: boolean; // false si fallo el barrido de permisos
  rows: GroupRow[];
  byEmail: Record<string, string[]>; // email en minuscula -> nombres de grupo
}

interface GroupDto {
  uuid: string;
  name: string;
  description?: string | null;
  owner?: string;
  federatedAttributeValues?: string[] | null;
  createdAt?: string;
  updatedAt?: string;
}

export function emptyGroupsResult(error?: string): GroupsResult {
  return {
    ok: false,
    error,
    total: 0,
    empty: 0,
    serviceAccounts: 0,
    withoutPermissions: 0,
    withPermissionsNoMembers: 0,
    onlyServiceAccounts: 0,
    permissionsOk: false,
    rows: [],
    byEmail: {},
  };
}

export async function fetchGroupsReport(
  creds: AccountCreds,
  knownEmails: Set<string>
): Promise<GroupsResult> {
  try {
    const token = await getAccessToken(creds, "account-idm-read");
    const account = encodeURIComponent(creds.accountUuid);
    const groups =
      (await apiGet<{ items?: GroupDto[] }>(token, `/iam/v1/accounts/${account}/groups`)).items ??
      [];

    let permissionFailures = 0;

    const scanned = await pool(groups, GROUP_CONCURRENCY, async (group) => {
      const path = `/iam/v1/accounts/${account}/groups/${encodeURIComponent(group.uuid)}`;
      const [members, permissions] = await Promise.all([
        apiGet<{ items?: { email?: string }[] }>(token, `${path}/users`).then((d) => d.items ?? []),
        // Los permisos son informacion extra: si un grupo falla se cuenta y se
        // sigue, en vez de tumbar todo el barrido.
        apiGet<{ permissions?: GroupPermission[] }>(token, `${path}/permissions`)
          .then((d) => d.permissions ?? [])
          .catch(() => {
            permissionFailures++;
            return [] as GroupPermission[];
          }),
      ]);

      const emails = members.map((m) => (m.email ?? "").toLowerCase()).filter(Boolean);
      const people = emails.filter((e) => knownEmails.has(e)).length;

      const row: GroupRow = {
        uuid: group.uuid,
        name: group.name,
        description: group.description ?? null,
        owner: group.owner ?? "LOCAL",
        federatedValues: group.federatedAttributeValues ?? [],
        createdAt: group.createdAt ?? null,
        updatedAt: group.updatedAt ?? null,
        members: emails.length,
        people,
        serviceAccounts: emails.length - people,
        permissions: permissions.length,
        scopeTypes: [...new Set(permissions.map((x) => x.scopeType))].sort(),
        permissionNames: [...new Set(permissions.map((x) => x.permissionName))].sort(),
      };
      return { row, emails };
    });

    // Membresia invertida (email -> nombres de grupo) a partir del mismo
    // barrido: volver a pedir los miembros seria duplicar las llamadas.
    const byEmail: Record<string, string[]> = {};
    const outsiders = new Set<string>();
    for (const { row, emails } of scanned) {
      for (const email of emails) {
        if (!knownEmails.has(email)) outsiders.add(email);
        else (byEmail[email] ??= []).push(row.name);
      }
    }
    for (const list of Object.values(byEmail)) list.sort((a, b) => a.localeCompare(b, "es"));

    const rows = scanned.map((x) => x.row);

    rows.sort((a, b) => b.members - a.members || a.name.localeCompare(b.name, "es"));

    return {
      ok: true,
      total: rows.length,
      empty: rows.filter((r) => r.members === 0).length,
      serviceAccounts: outsiders.size,
      withoutPermissions: rows.filter((r) => r.permissions === 0).length,
      withPermissionsNoMembers: rows.filter((r) => r.permissions > 0 && r.members === 0).length,
      onlyServiceAccounts: rows.filter((r) => r.members > 0 && r.people === 0).length,
      permissionsOk: permissionFailures === 0,
      rows,
      byEmail,
    };
  } catch (error) {
    // Los grupos son informacion adicional: si fallan (por ejemplo si al OAuth
    // client le falta permiso) el padron de usuarios se muestra igual.
    return emptyGroupsResult((error as Error).message);
  }
}
