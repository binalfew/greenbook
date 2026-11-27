import { parseWithZod } from "@conform-to/zod/v4";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import i18n, { initI18n } from "~/utils/i18n";
import "~/utils/validation-messages";

function errorsFor(schema: z.ZodType, values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  const submission = parseWithZod(formData, { schema });
  return submission.status === "success" ? {} : (submission.error ?? {});
}

describe("validation messages", () => {
  const schema = z.object({
    firstName: z.string().min(1).max(5),
    email: z.string().email().optional(),
    age: z.number().min(18).optional(),
    website: z.string().url().optional(),
    kind: z.enum(["a", "b"]).optional(),
    code: z.string().min(3).optional(),
    named: z.string().min(1, "Name is required"),
  });

  it("says a blank required field is required", async () => {
    await initI18n("en");
    expect(errorsFor(schema, { firstName: "" }).firstName).toEqual(["This field is required"]);
  });

  it("describes each kind of bad value in plain words", async () => {
    await i18n.changeLanguage("en");
    const errors = errorsFor(schema, {
      firstName: "Abebech",
      email: "nope",
      age: "abc",
      website: "nope",
      kind: "c",
      code: "x",
    });
    expect(errors).toMatchObject({
      firstName: ["Enter no more than 5 characters"],
      email: ["Enter a valid email address"],
      age: ["Enter a number"],
      website: ["Enter a valid web address, starting with https://"],
      kind: ["Choose one of the available options"],
      code: ["Enter at least 3 characters"],
    });
    expect(errorsFor(schema, { firstName: "A", named: "x", age: "5" }).age).toEqual([
      "Enter 18 or more",
    ]);
  });

  it("never leaks Zod's own wording", async () => {
    await i18n.changeLanguage("en");
    const all = Object.values(
      errorsFor(schema, { email: "x", age: "abc", website: "x", kind: "c", code: "x" }),
    ).flat();
    expect(all.join(" ")).not.toMatch(/expected|received|Invalid input|Too (small|big)/);
  });

  it("keeps a message written on the schema", () => {
    expect(errorsFor(z.object({ n: z.string().min(2, "Too short!") }), { n: "x" }).n).toEqual([
      "Too short!",
    ]);
  });

  it("follows the active language", async () => {
    await i18n.changeLanguage("fr");
    expect(errorsFor(schema, { firstName: "" }).firstName).toEqual(["Ce champ est obligatoire"]);
    await i18n.changeLanguage("en");
  });
});
