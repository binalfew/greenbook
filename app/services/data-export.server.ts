import { prisma } from "~/utils/db/db.server";

export type ExportFormat = "csv" | "json";

export interface ExportPayload {
  content: string;
  filename: string;
  contentType: string;
}

/**
 * Convert a row set into a CSV or JSON file payload. Generic — works for any
 * array of plain-object rows. Headers are inferred from the first row.
 *
 * CSV quoting handles commas, double quotes, and newlines per RFC 4180.
 */
export function rowsToExport(
  rows: Array<Record<string, unknown>>,
  entity: string,
  format: ExportFormat,
): ExportPayload {
  if (format === "json") {
    return {
      content: JSON.stringify(rows, null, 2),
      filename: `${entity}-export.json`,
      contentType: "application/json",
    };
  }

  if (rows.length === 0) {
    return { content: "", filename: `${entity}-export.csv`, contentType: "text/csv" };
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h] == null ? "" : String(row[h]);
          return val.includes(",") || val.includes('"') || val.includes("\n")
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        })
        .join(","),
    ),
  ];

  return {
    content: csvLines.join("\n"),
    filename: `${entity}-export.csv`,
    contentType: "text/csv",
  };
}

// ─── Per-entity exporters ─────────────────────────────────
// Apps built on the template add their own by following this shape.

export async function exportUsers(tenantId: string, format: ExportFormat): Promise<ExportPayload> {
  const users = await prisma.user.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? "",
    createdAt: u.createdAt.toISOString(),
  }));
  return rowsToExport(rows, "users", format);
}

export async function exportRoles(tenantId: string, format: ExportFormat): Promise<ExportPayload> {
  const roles = await prisma.role.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      description: true,
      scope: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
  const rows = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    scope: r.scope,
    createdAt: r.createdAt.toISOString(),
  }));
  return rowsToExport(rows, "roles", format);
}

/**
 * Entity dispatch for the built-in exporters. Apps that add more entities
 * typically wrap this with a larger switch in their own export helper.
 */
export async function exportEntity(
  entity: string,
  tenantId: string,
  format: ExportFormat,
): Promise<ExportPayload> {
  switch (entity) {
    case "users":
      return exportUsers(tenantId, format);
    case "roles":
      return exportRoles(tenantId, format);
    default:
      throw new Error(`Unsupported export entity: ${entity}`);
  }
}
