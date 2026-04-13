import prisma from "../db.server";
import { FREE_LIMIT } from "./billing.server";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function getUsage(shop: string) {
  const month = currentMonth();
  const usage = await prisma.usage.findUnique({
    where: { shop_month: { shop, month } },
  });
  return { count: usage?.count ?? 0, limit: FREE_LIMIT, month };
}

export async function incrementUsage(shop: string, amount: number = 1) {
  const month = currentMonth();
  await prisma.usage.upsert({
    where: { shop_month: { shop, month } },
    update: { count: { increment: amount } },
    create: { shop, month, count: amount },
  });
}

export async function canGenerate(shop: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  const { count } = await getUsage(shop);
  return count < FREE_LIMIT;
}

export async function remainingQuota(shop: string, isPro: boolean): Promise<number> {
  if (isPro) return Infinity;
  const { count } = await getUsage(shop);
  return Math.max(0, FREE_LIMIT - count);
}
