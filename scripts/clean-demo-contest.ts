/**
 * Removes leftover demo rows and inserts one ACTIVE contest.
 * Does not create an admin. Admin bootstrap stays in bootstrap-ripskis.ts
 * and requires RIPSKIS_ADMIN_EMAIL, RIPSKIS_ADMIN_PASSWORD, RIPSKIS_ADMIN_NAME.
 */
import { ContestStatus } from '@prisma/client';
import { prisma } from '../src/config/database.js';
import { assertContestTransition } from '../src/services/contest-lifecycle.js';

await prisma.rating.deleteMany();
await prisma.auditLog.deleteMany();
await prisma.submission.deleteMany();
await prisma.contest.deleteMany();
await prisma.category.deleteMany();
await prisma.user.deleteMany();

const created = await prisma.contest.create({
  data: {
    title: 'Ripskis Demo Contest',
    description: 'Ripskis demo contest for creator upload, moderation, and public judging.',
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    autoAdvanceDelayMs: 1800,
    status: ContestStatus.DRAFT,
  },
});
assertContestTransition(created.status, ContestStatus.SCHEDULED);
const scheduled = await prisma.contest.update({
  where: { id: created.id },
  data: { status: ContestStatus.SCHEDULED },
});
assertContestTransition(scheduled.status, ContestStatus.ACTIVE);
const active = await prisma.contest.update({
  where: { id: created.id },
  data: { status: ContestStatus.ACTIVE },
});

const users = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });
const contests = await prisma.contest.findMany({ select: { title: true, status: true } });
console.log(
  JSON.stringify({
    users,
    userCount: await prisma.user.count(),
    contests,
    submissions: await prisma.submission.count(),
    ratings: await prisma.rating.count(),
    categories: await prisma.category.count(),
    auditLogs: await prisma.auditLog.count(),
    contestStatus: active.status,
  }),
);

await prisma.$disconnect();
