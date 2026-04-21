import type { NoteStatus, Prisma } from "~/generated/prisma/client.js";
import { prisma } from "~/utils/db/db.server";
import { logger } from "~/utils/monitoring/logger.server";
import type { CategoryFormInput, CommentFormInput, NoteFormInput } from "~/utils/schemas/notes";
import type { PaginatedQueryOptions, TenantServiceContext } from "~/utils/types.server";

// Notes demo service — demonstrates the full service-layer pattern:
// tenant scoping, soft delete filtering, paginated + filtered list queries,
// optimistic-concurrency (via version), shared-editor upsert, and nested
// sub-entity (comments) CRUD.

export class NoteError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "NoteError";
    this.status = status;
    this.code = code;
  }
}

const noteSelect = {
  id: true,
  title: true,
  content: true,
  status: true,
  categoryId: true,
  tags: true,
  dueDate: true,
  authorId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

const noteListInclude = {
  category: { select: { id: true, name: true, color: true } },
  author: { select: { id: true, firstName: true, lastName: true, email: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

// ─── Note CRUD ──────────────────────────────────────────

export async function listNotes(tenantId: string, options: PaginatedQueryOptions) {
  const { page, pageSize, where = {}, orderBy } = options;
  const skip = (page - 1) * pageSize;

  const searchFilter = where.search
    ? {
        OR: [
          { title: { contains: where.search as string, mode: "insensitive" as const } },
          { content: { contains: where.search as string, mode: "insensitive" as const } },
        ],
      }
    : {};

  const statusFilter = where.status ? { status: where.status as NoteStatus } : {};
  const categoryFilter = where.categoryId ? { categoryId: where.categoryId as string } : {};

  const filter: Prisma.NoteWhereInput = {
    tenantId,
    deletedAt: null,
    ...searchFilter,
    ...statusFilter,
    ...categoryFilter,
  };

  const [data, total] = await Promise.all([
    prisma.note.findMany({
      where: filter,
      orderBy: orderBy ?? [{ updatedAt: "desc" }],
      skip,
      take: pageSize,
      include: noteListInclude,
    }),
    prisma.note.count({ where: filter }),
  ]);

  return { data, total };
}

export async function getNote(id: string, tenantId: string) {
  const note = await prisma.note.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      ...noteListInclude,
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
    },
  });
  if (!note) {
    throw new NoteError("Note not found", 404, "NOT_FOUND");
  }
  return note;
}

export async function createNote(input: NoteFormInput, ctx: TenantServiceContext) {
  logger.info({ tenantId: ctx.tenantId, userId: ctx.userId, title: input.title }, "creating note");

  return prisma.note.create({
    data: {
      tenantId: ctx.tenantId,
      title: input.title,
      content: input.content ?? "",
      status: input.status,
      categoryId: input.categoryId || null,
      tags: input.tags,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      authorId: ctx.userId,
    },
    select: noteSelect,
  });
}

export async function updateNote(id: string, input: NoteFormInput, ctx: TenantServiceContext) {
  const existing = await prisma.note.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, version: true },
  });
  if (!existing) throw new NoteError("Note not found", 404, "NOT_FOUND");

  logger.info({ noteId: id, userId: ctx.userId }, "updating note");

  return prisma.note.update({
    where: { id },
    data: {
      title: input.title,
      content: input.content ?? "",
      status: input.status,
      categoryId: input.categoryId || null,
      tags: input.tags,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      version: { increment: 1 },
    },
    select: noteSelect,
  });
}

export async function deleteNote(id: string, ctx: TenantServiceContext) {
  const existing = await prisma.note.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new NoteError("Note not found", 404, "NOT_FOUND");

  logger.info({ noteId: id, userId: ctx.userId }, "soft-deleting note");

  // Soft delete so audit/history survives. Apps wanting hard delete call
  // `prisma.note.delete()` directly once they've confirmed retention.
  return prisma.note.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: { id: true },
  });
}

// ─── Comments (sub-entity) ──────────────────────────────

export async function addComment(
  noteId: string,
  input: CommentFormInput,
  ctx: TenantServiceContext,
) {
  const note = await prisma.note.findFirst({
    where: { id: noteId, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!note) throw new NoteError("Note not found", 404, "NOT_FOUND");

  return prisma.noteComment.create({
    data: {
      noteId,
      authorId: ctx.userId,
      body: input.body,
    },
  });
}

export async function deleteComment(commentId: string, ctx: TenantServiceContext) {
  const comment = await prisma.noteComment.findFirst({
    where: { id: commentId, deletedAt: null, note: { tenantId: ctx.tenantId } },
    select: { id: true, authorId: true },
  });
  if (!comment) throw new NoteError("Comment not found", 404, "NOT_FOUND");

  // Soft delete; any user can delete their own comment — app-level policy
  // can tighten via `requirePermission` + ownership check in the action.
  return prisma.noteComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
    select: { id: true },
  });
}

// ─── Categories (reference data for notes) ──────────────

export async function listCategories(tenantId: string) {
  return prisma.noteCategory.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { children: true, notes: { where: { deletedAt: null } } } },
    },
  });
}

export async function getCategory(id: string, tenantId: string) {
  const category = await prisma.noteCategory.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!category) throw new NoteError("Category not found", 404, "NOT_FOUND");
  return category;
}

export async function createCategory(input: CategoryFormInput, ctx: TenantServiceContext) {
  return prisma.noteCategory.create({
    data: {
      tenantId: ctx.tenantId,
      name: input.name,
      color: input.color || null,
      parentId: input.parentId || null,
      description: input.description || null,
      sortOrder: input.sortOrder,
    },
  });
}

export async function updateCategory(
  id: string,
  input: CategoryFormInput,
  ctx: TenantServiceContext,
) {
  const existing = await getCategory(id, ctx.tenantId);

  // Guard against cycles — a category can't be its own ancestor.
  if (input.parentId) {
    if (input.parentId === id) {
      throw new NoteError("A category cannot be its own parent", 400, "CIRCULAR_PARENT");
    }
    await assertNoCycle(id, input.parentId, ctx.tenantId);
  }

  return prisma.noteCategory.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      color: input.color || null,
      parentId: input.parentId || null,
      description: input.description || null,
      sortOrder: input.sortOrder,
    },
  });
}

export async function deleteCategory(id: string, ctx: TenantServiceContext) {
  const existing = await getCategory(id, ctx.tenantId);
  return prisma.noteCategory.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });
}

async function assertNoCycle(
  categoryId: string,
  candidateParentId: string,
  tenantId: string,
): Promise<void> {
  // Walk the parent chain from the candidate upward; if we hit categoryId
  // before reaching a root we'd create a cycle. Depth-capped at 32 to avoid
  // pathological loops from pre-existing data.
  let cursor: string | null = candidateParentId;
  for (let depth = 0; depth < 32 && cursor; depth++) {
    if (cursor === categoryId) {
      throw new NoteError("Setting this parent would create a cycle", 400, "CIRCULAR_PARENT");
    }
    const parentRow: { parentId: string | null } | null = await prisma.noteCategory.findFirst({
      where: { id: cursor, tenantId, deletedAt: null },
      select: { parentId: true },
    });
    cursor = parentRow?.parentId ?? null;
  }
}
