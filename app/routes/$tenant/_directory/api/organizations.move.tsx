import { data, redirect } from "react-router";
import { dispatchDirectoryChange } from "~/utils/directory-submit.server";
import { requireDirectoryAccess } from "~/utils/directory-access.server";
import type { Route } from "./+types/organizations.move";

// Resource route used by the organizations tree for drag-and-drop reparenting.
// Posts arrive from react-arborist's onMove flow:
//   { intent: "move", organizationId: "<id>", parentId: "" | "<parent-id>" }
//
// Global admin only: it takes `organization:write`, which neither focal
// persons nor managers hold. They do not see the drag handle either.

export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${params.tenant}/organogram`);
}

export async function action({ request }: Route.ActionArgs) {
  // Gate at the route boundary too — dispatchDirectoryChange will also
  // 403 anyone without the write permission, but this keeps the error shape
  // consistent and avoids touching the engine for unauthorized callers.
  const access = await requireDirectoryAccess(request, { write: "organization" });
  if (!access.canDirect) {
    throw new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "move") {
    return data({ error: "Unknown intent" }, { status: 400 });
  }

  const organizationId = String(form.get("organizationId") ?? "").trim();
  if (!organizationId) {
    return data({ error: "organizationId is required" }, { status: 400 });
  }

  const rawParent = form.get("parentId");
  const parentId = typeof rawParent === "string" && rawParent.trim() ? rawParent.trim() : null;

  // `requireDirectoryAccess`-style throws bubble up as Response objects —
  // let those through. Only catch domain errors from the change engine
  // (OrganizationError / ChangeRequestError) which carry `.status: number`.
  try {
    const outcome = await dispatchDirectoryChange(request, "organization", {
      entityType: "ORGANIZATION",
      operation: "MOVE",
      entityId: organizationId,
      payload: { parentId },
    });
    if (outcome.conflict) {
      return data({ ok: false, error: outcome.conflict.message }, { status: 409 });
    }
    return data({ ok: true, changeId: outcome.change.id, mode: outcome.mode });
  } catch (err) {
    if (err instanceof Response) throw err;
    const status =
      err instanceof Error && "status" in err && typeof err.status === "number" ? err.status : 400;
    const message = err instanceof Error ? err.message : "Failed to apply move";
    return data({ ok: false, error: message }, { status });
  }
}
