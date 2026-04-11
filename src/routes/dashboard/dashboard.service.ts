import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getHrJobs(hrUserId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [totalItems, jobs] = await this.prisma.$transaction([
      // Lọc chuẩn xác theo creatorId
      this.prisma.jobDescription.count({ where: { creatorId: hrUserId } }),
      this.prisma.jobDescription.findMany({
        where: { creatorId: hrUserId },
        orderBy: { createdAt: 'desc' },
        skip: skip,
        take: limit,
        select: {
          id: true,
          title: true,
          hrEmail: true,
          createdAt: true,
          _count: { select: { applications: true } },
        },
      }),
    ]);

    return {
      meta: {
        totalItems,
        itemCount: jobs.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
      items: jobs,
    };
  }

  async getJobLeaderboard(jobId: string, page: number, limit: number) {
    const job = await this.prisma.jobDescription.findUnique({
      where: { id: jobId },
      select: { title: true },
    });

    if (!job) throw new NotFoundException('Không tìm thấy Job này');

    const skip = (page - 1) * limit;

    const [totalItems, candidates] = await this.prisma.$transaction([
      this.prisma.application.count({ where: { jobId } }),
      this.prisma.application.findMany({
        where: { jobId },
        orderBy: { matchScore: 'desc' },
        skip: skip,
        take: limit,
        include: {
          user: {
            select: {
              name: true,
              email: true,
              avatarUrl: true,
              githubUsername: true,
            },
          },
        },
      }),
    ]);

    return {
      jobTitle: job.title,
      meta: {
        totalItems,
        itemCount: candidates.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
      leaderboard: candidates,
    };
  }
}
