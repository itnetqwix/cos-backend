import { prisma } from '../src/config/database.js';
import { runPledgeMonthJob } from '../src/jobs/pledge-month.js';

runPledgeMonthJob()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.log(JSON.stringify({
      event: 'pledge-month',
      result: 'failed',
      error: error instanceof Error ? error.message : 'Pledge month job failed',
    }));
    await prisma.$disconnect();
    process.exitCode = 1;
  });
