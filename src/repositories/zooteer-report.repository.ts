import { ZooteerReportCategory, ZooteerReportStatus } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface ZooteerReportRecord {
  id: string;
  roomId: string;
  reporterId: string;
  reportedUserId: string;
  category: ZooteerReportCategory;
  description: string | null;
  status: ZooteerReportStatus;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  reviewedById: string | null;
}

type ReportWhere = {
  id?: string;
  roomId?: string;
  status?: ZooteerReportStatus;
};

export interface ZooteerReportDb {
  zooteerAbuseReport: {
    create(args: { data: Record<string, unknown> }): Promise<ZooteerReportRecord>;
    findFirst(args: { where: ReportWhere }): Promise<ZooteerReportRecord | null>;
    findMany(args: {
      where: ReportWhere;
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<ZooteerReportRecord[]>;
    count(args: { where: ReportWhere }): Promise<number>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ZooteerReportRecord>;
  };
}

function bind(client: typeof prisma): ZooteerReportDb {
  return {
    zooteerAbuseReport:
      client.zooteerAbuseReport as unknown as ZooteerReportDb['zooteerAbuseReport'],
  };
}

let current: ZooteerReportDb = bind(prisma);

export function zooteerReportDb(): ZooteerReportDb {
  return current;
}

export function setZooteerReportDb(next: ZooteerReportDb | null): void {
  current = next ?? bind(prisma);
}
