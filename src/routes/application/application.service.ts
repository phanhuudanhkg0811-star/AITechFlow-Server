import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class ApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async getApplicationsByUserId(userId: string) {
    return await this.prisma.application.findMany({
      where: { userId: userId },
      select: {
        id: true,
        status: true,
        job: { select: { title: true } },
        testSession: {
          select: {
            id: true,
            scenario: {
              select: {
                title: true,
                difficulty: true,
                timeLimit: true,
                context: true,
              },
            },
          },
        },
      },
      orderBy: { status: 'asc' },
    });
  }
}
