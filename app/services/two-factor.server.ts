import { generateTOTP, getTOTPAuthUri, verifyTOTP } from "@epic-web/totp";
import * as QRCode from "qrcode";
import { prisma } from "~/utils/db/db.server";
import { twoFAVerificationType, twoFAVerifyVerificationType } from "~/utils/auth/constants";
import { getDomainUrl } from "~/utils/misc";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const FAR_FUTURE = new Date("2099-12-31T23:59:59Z");

export interface TwoFAPolicy {
  mode: "off" | "all" | "roles";
  roleIds: string[];
}

const TWO_FA_POLICY_KEY = "security.require2fa";

export async function getTwoFAPolicy(tenantId: string): Promise<TwoFAPolicy> {
  const setting = await prisma.systemSetting.findUnique({
    where: {
      key_scope_scopeId: { key: TWO_FA_POLICY_KEY, scope: "tenant", scopeId: tenantId },
    },
  });
  if (!setting) return { mode: "off", roleIds: [] };

  const value = setting.value;
  if (value === "all") return { mode: "all", roleIds: [] };
  if (value.startsWith("roles:")) {
    const roleIds = value
      .slice(6)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return { mode: "roles", roleIds };
  }
  return { mode: "off", roleIds: [] };
}

export async function isUserRequired2FA(userId: string, tenantId: string): Promise<boolean> {
  const policy = await getTwoFAPolicy(tenantId);
  if (policy.mode === "off") return false;
  if (policy.mode === "all") return true;
  if (policy.roleIds.length === 0) return false;
  const matches = await prisma.userRole.count({
    where: { userId, roleId: { in: policy.roleIds } },
  });
  return matches > 0;
}

export type TwoFASetupPayload = {
  qrCode: string;
  secret: string;
  otpUri: string;
  issuer: string;
};

export async function start2FASetup(
  userId: string,
  userEmail: string,
  request: Request,
): Promise<TwoFASetupPayload> {
  const { otp: _otp, ...config } = await generateTOTP();
  const expiresAt = new Date(Date.now() + TEN_MINUTES_MS);

  await prisma.verification.upsert({
    where: { target_type: { type: twoFAVerifyVerificationType, target: userId } },
    update: { ...config, expiresAt },
    create: { ...config, type: twoFAVerifyVerificationType, target: userId, expiresAt },
  });

  const issuer = new URL(getDomainUrl(request)).host;
  const otpUri = getTOTPAuthUri({
    ...config,
    accountName: userEmail,
    issuer,
  });
  const qrCode = await QRCode.toDataURL(otpUri);

  return { qrCode, secret: config.secret, otpUri, issuer };
}

export async function verify2FASetup(userId: string, code: string): Promise<boolean> {
  const verification = await prisma.verification.findUnique({
    where: { target_type: { type: twoFAVerifyVerificationType, target: userId } },
  });
  if (!verification) return false;
  if (verification.expiresAt && verification.expiresAt < new Date()) return false;

  const result = await verifyTOTP({
    otp: code,
    secret: verification.secret,
    algorithm: verification.algorithm,
    digits: verification.digits,
    period: verification.period,
    charSet: verification.charSet,
  });
  if (!result) return false;

  // Promote the pending 2fa-verify record into a permanent 2fa record.
  await prisma.verification.update({
    where: { target_type: { type: twoFAVerifyVerificationType, target: userId } },
    data: { type: twoFAVerificationType, expiresAt: FAR_FUTURE },
  });

  return true;
}

export async function verify2FAChallenge(userId: string, code: string): Promise<boolean> {
  const verification = await prisma.verification.findUnique({
    where: { target_type: { type: twoFAVerificationType, target: userId } },
  });
  if (!verification) return false;

  const result = await verifyTOTP({
    otp: code,
    secret: verification.secret,
    algorithm: verification.algorithm,
    digits: verification.digits,
    period: verification.period,
    charSet: verification.charSet,
  });
  return Boolean(result);
}

export async function disable2FA(userId: string): Promise<void> {
  await prisma.verification.deleteMany({
    where: {
      target: userId,
      type: { in: [twoFAVerificationType, twoFAVerifyVerificationType] },
    },
  });
}

export async function is2FAEnabled(userId: string): Promise<boolean> {
  const verification = await prisma.verification.findUnique({
    select: { id: true },
    where: { target_type: { type: twoFAVerificationType, target: userId } },
  });
  return Boolean(verification);
}
