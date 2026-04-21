import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "~/utils/db/db.server";
import { RECOVERY_CODE_COUNT } from "~/utils/auth/constants";

const CODE_LENGTH = 8;
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
const BCRYPT_COST = 10;

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join("");
}

/**
 * Generate a fresh set of recovery codes for the user. Plaintext codes are
 * returned once to the caller and must NOT be stored beyond that call.
 * Any previously-issued codes are deleted to prevent accidental reuse.
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  await prisma.recoveryCode.deleteMany({ where: { userId } });

  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateCode();
    codes.push(code);
    const codeHash = await bcrypt.hash(code, BCRYPT_COST);
    await prisma.recoveryCode.create({ data: { userId, codeHash } });
  }

  return codes;
}

/**
 * Validate a user-submitted recovery code. Returns true and marks the code used
 * on first match; subsequent attempts with the same code return false.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const candidates = await prisma.recoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  const normalized = code.toLowerCase().trim();
  for (const rc of candidates) {
    const matches = await bcrypt.compare(normalized, rc.codeHash);
    if (matches) {
      await prisma.recoveryCode.update({
        where: { id: rc.id },
        data: { usedAt: new Date() },
      });
      return true;
    }
  }

  return false;
}

export async function countRemainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}
