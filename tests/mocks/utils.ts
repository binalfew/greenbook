import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDirPath = path.join(__dirname, "..", "fixtures");

export function readFixture(subdir: string, name: string) {
  const filePath = path.join(fixturesDirPath, subdir, `${name}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function createFixture(subdir: string, name: string, data: unknown) {
  const dir = path.join(fixturesDirPath, subdir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}

// ─── Email fixtures ──────────────────────────────────────

export const EmailSchema = z.object({
  to: z.string(),
  from: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string().optional(),
});

export function writeEmail(rawEmail: unknown) {
  const email = EmailSchema.parse(rawEmail);
  createFixture("email", email.to, email);
  return email;
}

export function requireEmail(recipient: string) {
  const email = readEmail(recipient);
  if (!email) throw new Error(`Email to ${recipient} not found`);
  return email;
}

export function readEmail(recipient: string) {
  try {
    const data = readFixture("email", recipient);
    if (!data) return null;
    return EmailSchema.parse(data);
  } catch (error) {
    console.error("Error reading email", error);
    return null;
  }
}

export function requireHeader(headers: Headers, header: string) {
  if (!headers.has(header)) {
    const headersString = JSON.stringify(Object.fromEntries(headers.entries()), null, 2);
    throw new Error(`Header "${header}" required, but not found in ${headersString}`);
  }
  return headers.get(header);
}
