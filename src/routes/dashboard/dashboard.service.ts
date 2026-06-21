import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(hrUserId: string) {
    // 1. Tìm tất cả các Job do HR này tạo
    const myJobs = await this.prisma.jobDescription.findMany({
      where: { creatorId: hrUserId },
      select: { id: true },
    });

    const jobIds = myJobs.map((job) => job.id);

    if (jobIds.length === 0) {
      return { totalCandidates: 0, runningTests: 0, analyzedByAI: 0, hired: 0 };
    }

    // 2. Chạy 4 query song song bằng Promise.all để tối ưu tốc độ
    const [totalCandidates, runningTests, analyzedByAI, hired] =
      await Promise.all([
        // Tổng số hồ sơ
        this.prisma.application.count({ where: { jobId: { in: jobIds } } }),
        // Bài test đang làm (TESTING)
        this.prisma.application.count({
          where: { jobId: { in: jobIds }, status: 'TESTING' },
        }),
        // Đã nộp bài và đang/đã chấm (REVIEWING hoặc COMPLETED)
        this.prisma.application.count({
          where: {
            jobId: { in: jobIds },
            status: { in: ['REVIEWING', 'COMPLETED'] },
          },
        }),
        // Đã duyệt thành công (COMPLETED)
        this.prisma.application.count({
          where: { jobId: { in: jobIds }, status: 'COMPLETED' },
        }),
      ]);

    return { totalCandidates, runningTests, analyzedByAI, hired };
  }
  //Lấy tất cả application, order từ mới nhất đến cũ nhất
  async getRecentApplications(hrUserId: string) {
    const apps = await this.prisma.application.findMany({
      where: {
        job: { creatorId: hrUserId },
      },
      include: {
        user: { select: { name: true, email: true } },
        job: { select: { title: true } },
      },
    });

    return apps.map((app) => ({
      id: app.id,
      candidate: app.user.name || app.user.email.split('@')[0],
      job: app.job.title,
      score: app.matchScore,
      status: app.status,
    }));
  }

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
          emailAccount: { select: { email: true } },
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
      items: jobs.map((job) => ({
        ...job,
        hrEmail: job.emailAccount?.email ?? null,
      })),
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

  // Trong class DashboardService
  async getApplicationDetail(applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        user: true,
        job: true,
        testSessions: {
          include: { conversations: true },
        },
        report: true,
      },
    });

    if (!application) throw new NotFoundException('Không tìm thấy ứng viên');

    // Trả về toàn bộ object, trong đó có sẵn application.cvText
    return application;
  }
}
