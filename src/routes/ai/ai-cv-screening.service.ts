/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// src/routes/ai/ai-cv-screening.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import envConfig from 'src/shared/config';

@Injectable()
export class CvScreeningService {
  private readonly logger = new Logger(CvScreeningService.name);
  private genAI: GoogleGenerativeAI;

  constructor(private prisma: PrismaService) {
    this.genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY);
  }

  // Hàm tạo embedding 3072 chiều
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // DÙNG gemini-embedding-001 ĐỂ RA VECTOR 3072 CHIỀU
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-embedding-001',
      });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      this.logger.error('Lỗi khi tạo embedding:', error);
      throw error;
    }
  }

  async evaluateCvMatching(applicationId: string): Promise<number> {
    try {
      // 1. Lấy application và job
      const application = await this.prisma.application.findUnique({
        where: { id: applicationId },
        include: { job: true },
      });
      if (!application) throw new Error('Application not found');

      // 2. Tạo vector cho CV
      this.logger.log(`Đang tạo embedding 3072 cho CV ID: ${applicationId}`);
      const cvVector = await this.generateEmbedding(application.cvText);
      const vectorString = `[${cvVector.join(',')}]`;

      // 3. Lưu vector CV vào DB
      await this.prisma.$executeRawUnsafe(`
        UPDATE "Application" 
        SET "cvEmbedding" = '${vectorString}'::vector 
        WHERE id = '${applicationId}'
      `);

      // 4. Tính similarity giữa CV và JD (cùng 3072 chiều)
      const matchResult: any = await this.prisma.$queryRawUnsafe(`
        SELECT 1 - ("cvEmbedding" <=> (SELECT "embedding" FROM "JobDescription" WHERE id = '${application.jobId}')) AS similarity
        FROM "Application"
        WHERE id = '${applicationId}'
      `);

      const similarityScore = matchResult[0]?.similarity;
      let finalScore = 0;

      if (similarityScore) {
        finalScore = Math.round(similarityScore * 100 * 100) / 100;
        await this.prisma.application.update({
          where: { id: applicationId },
          data: {
            matchScore: finalScore,
          },
        });
      }

      this.logger.log(`Điểm phù hợp CV: ${finalScore}%`);
      return finalScore;
    } catch (error) {
      this.logger.error('Lỗi khi chấm điểm CV:', error);
      throw error;
    }
  }
}
