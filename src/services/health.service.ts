import { prisma } from '../config/database.js';

/** Confirms the process can run a query. The error is left for the caller to log. */
export async function assertDatabaseReady(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
