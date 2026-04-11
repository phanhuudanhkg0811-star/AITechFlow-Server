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

  // Hàm này biến văn bản thành Vector (Dãy 768 con số)
  async generateEmbedding(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({
      model: 'text-embedding-004',
    });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  // Hàm "Trùm Cuối": Chấm điểm CV so với JD
  async evaluateCvMatching(applicationId: string) {
    try {
      // 1. Lấy thông tin Đơn ứng tuyển và JD
      const application = await this.prisma.application.findUnique({
        where: { id: applicationId },
        include: { job: true },
      });

      if (!application) throw new Error('Application not found');

      // 2. Gọi Google AI để nhúng (embed) nội dung CV thành Vector
      this.logger.log(`Đang phân tích Vector cho CV ID: ${applicationId}`);
      const cvVector = await this.generateEmbedding(application.cvText);
      const vectorString = `[${cvVector.join(',')}]`; // Ép kiểu mảng thành string chuẩn của pgvector

      // 3. Lưu Vector CV xuống Database bằng Raw SQL
      // Do Prisma không hỗ trợ ghi đè kiểu Unsupported trực tiếp qua ORM
      await this.prisma.$executeRawUnsafe(`
        UPDATE "Application" 
        SET "cvEmbedding" = '${vectorString}'::vector 
        WHERE id = '${applicationId}'
      `);

      // 4. Tính toán độ phù hợp (Cosine Similarity) giữa CV và JD
      // Toán tử <=> trong pgvector tính Khoảng Cách Cosine.
      // Độ tương đồng = 1 - Khoảng cách.
      const matchResult: any = await this.prisma.$queryRawUnsafe(`
        SELECT 1 - ("cvEmbedding" <=> (SELECT "embedding" FROM "JobDescription" WHERE id = '${application.jobId}')) AS similarity
        FROM "Application"
        WHERE id = '${applicationId}'
      `);

      // 5. Cập nhật Match Score vào Application
      const similarityScore = matchResult[0]?.similarity;
      let finalScore = 0;

      if (similarityScore) {
        // Đổi từ hệ số (0-1) sang thang điểm 100%
        finalScore = Math.round(similarityScore * 100 * 100) / 100;

        await this.prisma.application.update({
          where: { id: applicationId },
          data: {
            matchScore: finalScore,
            status: finalScore > 70 ? 'TESTING' : 'REJECTED', // Ví dụ: > 70 điểm thì cho đi Test IDE
          },
        });
      }

      this.logger.log(`Hoàn tất! Điểm phù hợp CV: ${finalScore}%`);
      return finalScore;
    } catch (error) {
      this.logger.error('Lỗi khi chấm điểm CV:', error);
      throw error;
    }
  }
}
