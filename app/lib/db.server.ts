import prisma from "./prisma";

export async function getOrgans() {
  return prisma.organ.findMany();
}

export async function getOrgan(id: string) {
  return prisma.organ.findUnique({
    where: { id },
  });
}
