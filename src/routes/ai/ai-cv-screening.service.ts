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

  async evaluateTextMatching(
    cvText: string,
    jobId: string,
  ): Promise<{ score: number; vectorString: string }> {
    try {
      this.logger.log(`Đang tạo embedding 3072 cho CV Text...`);
      const cvVector = await this.generateEmbedding(cvText);
      const vectorString = `[${cvVector.join(',')}]`;

      // Thực thi phép tính Cosine Similarity (<=>) trực tiếp giữa chuỗi Vector và Job
      const matchResult: any = await this.prisma.$queryRawUnsafe(`
        SELECT 1 - ('${vectorString}'::vector <=> (SELECT "embedding" FROM "JobDescription" WHERE id = '${jobId}')) AS similarity
      `);

      const similarityScore = matchResult[0]?.similarity;
      const finalScore = similarityScore
        ? Math.round(similarityScore * 100 * 100) / 100
        : 0;

      return { score: finalScore, vectorString };
    } catch (error) {
      this.logger.error('Lỗi khi chấm điểm CV trực tiếp:', error);
      throw error;
    }
  }
}
