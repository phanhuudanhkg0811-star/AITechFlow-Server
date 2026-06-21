/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';
import { AiService } from './ai.service';

@Injectable()
export class CvScreeningService {
  private readonly logger = new Logger(CvScreeningService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  async generateEmbedding(
    text: string,
    companyId?: string,
  ): Promise<number[]> {
    try {
      return this.aiService.generateEmbedding(text, { companyId });
    } catch (error) {
      this.logger.error('Failed to generate CV embedding:', error);
      throw error;
    }
  }

  async evaluateTextMatching(
    cvText: string,
    jobId: string,
  ): Promise<{ score: number; vectorString: string }> {
    try {
      this.logger.log('Generating 3072-dimension embedding for CV text...');

      const job = await this.prisma.jobDescription.findUnique({
        where: { id: jobId },
        select: { companyId: true },
      });

      const cvVector = await this.generateEmbedding(cvText, job?.companyId);
      const vectorString = `[${cvVector.join(',')}]`;

      const matchResult: any = await this.prisma.$queryRawUnsafe(`
        SELECT 1 - ('${vectorString}'::vector <=> (SELECT "embedding" FROM "JobDescription" WHERE id = '${jobId}')) AS similarity
      `);

      const similarityScore = matchResult[0]?.similarity;
      const finalScore = similarityScore
        ? Math.round(similarityScore * 100 * 100) / 100
        : 0;

      return { score: finalScore, vectorString };
    } catch (error) {
      this.logger.error('Failed to evaluate CV text matching:', error);
      throw error;
    }
  }
}
