import type { User } from "@prisma/client";
import prisma from "./prisma";

export async function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email },
  });
}

export async function getOrgans() {
  return prisma.organ.findMany();
}

export async function getOrgan(id: string) {
  return prisma.organ.findUnique({
    where: { id },
  });
}
