import { parseWithZod } from "@conform-to/zod/v4";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { memberStateFormSchema } from "~/routes/$tenant/settings/references/member-states/+shared/member-state-schema";
import { organizationTypeFormSchema } from "~/routes/$tenant/settings/references/organization-types/+shared/organization-type-schema";
import { positionTypeFormSchema } from "~/routes/$tenant/settings/references/position-types/+shared/position-type-schema";
import { regionalGroupFormSchema } from "~/routes/$tenant/settings/references/regional-groups/+shared/regional-group-schema";
import { titleFormSchema } from "~/routes/$tenant/settings/references/titles/+shared/title-schema";
import {
  assignPersonFormSchema,
  endAssignmentFormSchema,
  organizationFormSchema,
  personCreateFormSchema,
  personFormSchema,
  positionFormSchema,
  rejectChangeSchema,
} from "~/utils/schemas/directory";
import { contactInfoSchema } from "~/utils/schemas/organization";
import { changePasswordSchema, profileSchema } from "~/utils/schemas/profile";
import {
  createPermissionSchema,
  createRoleSchema,
  createUserSchema,
  updateUserSchema,
} from "~/utils/schemas/security";
import { createSSOConfigSchema } from "~/utils/schemas/sso";
import { createTenantSchema } from "~/utils/schemas/tenant";
import { VerifySchema } from "~/utils/types";

// This file deliberately does not load `~/utils/validation-messages`: each
// form schema has to describe its own fields without the global fallback.

/** Fields the user never fills in (hidden inputs the page supplies). */
const HIDDEN: Record<string, string> = {
  positionId: "p1",
  id: "a1",
  personId: "pe1",
  startDate: "2026-01-01",
  type: "reset-password",
  target: "someone@example.org",
};

const SCHEMAS: Array<[string, z.ZodType, string[]]> = [
  ["organization", organizationFormSchema, []],
  ["person", personFormSchema, []],
  ["position", positionFormSchema, []],
  ["assign person", assignPersonFormSchema, ["positionId"]],
  ["end assignment", endAssignmentFormSchema, ["id", "positionId", "personId", "startDate"]],
  ["reject change", rejectChangeSchema, []],
  ["contact info", contactInfoSchema, []],
  ["profile", profileSchema, []],
  ["change password", changePasswordSchema, []],
  ["create user", createUserSchema, []],
  ["update user", updateUserSchema, []],
  ["role", createRoleSchema, []],
  ["permission", createPermissionSchema, []],
  ["sso", createSSOConfigSchema, []],
  ["tenant", createTenantSchema, []],
  ["member state", memberStateFormSchema, []],
  ["organization type", organizationTypeFormSchema, []],
  ["position type", positionTypeFormSchema, []],
  ["regional group", regionalGroupFormSchema, []],
  ["title", titleFormSchema, []],
  ["verify", VerifySchema, ["type", "target"]],
];

const TECHNICAL = /expected|received|Invalid input|Too (small|big)|Invalid option|^Required$/;

function messages(schema: z.ZodType, values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  const submission = parseWithZod(formData, { schema });
  return submission.status === "success" ? {} : (submission.error ?? {});
}

describe("form schema messages", () => {
  it.each(SCHEMAS)("%s: a blank form names each missing field", (_name, schema, hidden) => {
    const values = Object.fromEntries(hidden.map((key) => [key, HIDDEN[key]!]));
    const errors = messages(schema, values);
    for (const [field, fieldErrors] of Object.entries(errors)) {
      for (const message of fieldErrors ?? []) {
        expect(message, `${field}: ${message}`).not.toMatch(TECHNICAL);
      }
    }
  });

  it("says which field is missing", () => {
    expect(messages(personFormSchema, {})).toMatchObject({
      firstName: ["First name is required"],
      lastName: ["Last name is required"],
    });
    expect(messages(createUserSchema, {})).toMatchObject({
      firstName: ["First name is required"],
      email: ["Email is required"],
      password: ["Password is required"],
    });
  });

  it("requires a person's contact details, and a first position for a new person", () => {
    expect(messages(personFormSchema, { email: "nope" })).toMatchObject({
      email: ["Enter a valid email address"],
      phone: ["Phone is required"],
      officeEmail: ["Official email is required"],
      officePhone: ["Official phone is required"],
    });
    expect(messages(personFormSchema, {})).not.toHaveProperty("initialPositionId");
    expect(messages(personCreateFormSchema, {})).toMatchObject({
      initialPositionId: ["Position is required"],
      initialStartDate: ["Start date is required"],
    });
  });

  it("describes a wrong value", () => {
    expect(messages(createUserSchema, { email: "nope" }).email).toEqual([
      "Enter a valid email address",
    ]);
    expect(messages(titleFormSchema, { sortOrder: "abc" }).sortOrder).toEqual([
      "Sort order must be a number",
    ]);
    expect(messages(organizationFormSchema, { sortOrder: "-1" }).sortOrder).toEqual([
      "Sort order must be 0 or greater",
    ]);
  });
});
