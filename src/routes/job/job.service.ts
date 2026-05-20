/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import envConfig from 'src/shared/config';
import type { CreateJobWithScenarioDto } from './job.dto';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private genAI: GoogleGenerativeAI;

  constructor(private prisma: PrismaService) {
    this.genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      this.logger.log('Bắt đầu nhúng Vector bằng SDK chính chủ...');

      const genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY);

      const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

      const result = await model.embedContent(text);
      const embedding = result.embedding;

      return embedding.values;
    } catch (error: any) {
      this.logger.error('Lỗi khi nhúng Vector bằng SDK:', error);
      throw error;
    }
  }
  // Gộp chung Transaction và AI vào một hàm
  async createJobAndScenario(dto: CreateJobWithScenarioDto, creatorId: string) {
    this.logger.log(`Đang tạo Job Description: ${dto.title}`);

    const existEmail = await this.prisma.jobDescription.findUnique({
      where: {
        hrEmail: dto.hrEmail,
      },
    });

    if (existEmail) {
      throw new UnprocessableEntityException(
        'HR Email đã tồn tại, vui lòng chọn email khác cho job này!',
      );
    }

    const { newJob, newScenario } = await this.prisma.$transaction(
      async (tx) => {
        // 1.1. Tạo Job
        const job = await tx.jobDescription.create({
          data: {
            title: dto.title,
            content: dto.content,
            hrEmail: dto.hrEmail ? dto.hrEmail : null, // Hòm thư chiến dịch (Lấy từ Frontend gửi lên)
            creatorId: creatorId, // Gắn ID của HR tạo job (Lấy từ Token)
          },
        });

        // 1.2. Tạo bài Test kèm theo
        const scenario = await tx.testScenario.create({
          data: {
            jobId: job.id,
            title: dto.scenarioTitle,
            difficulty: dto.difficulty,
            timeLimit: dto.timeLimit,
            context: dto.scenarioContext,
            initialCode: {}, // Rỗng lúc đầu, khởi tạo sẵn cho WebContainers
          },
        });

        // Return của hàm con (Đẩy kết quả ra biến ở ngoài)
        return { newJob: job, newScenario: scenario };
      },
    );

    // ---------------------------------------------------------
    // BƯỚC 2: Gọi AI Gemini để nhúng Vector cho nội dung JD
    // ---------------------------------------------------------
    try {
      this.logger.log('Đang tạo Vector Embedding cho nội dung JD...');

      // Gọi hàm nhúng đã định nghĩa phía trên
      const embeddingVector = await this.generateEmbedding(dto.content);
      const vectorString = `[${embeddingVector.join(',')}]`; // Ép mảng thành string cho pgvector

      // Dùng Raw SQL để cập nhật cột Unsupported("vector")
      await this.prisma.$executeRawUnsafe(`
        UPDATE "JobDescription" 
        SET "embedding" = '${vectorString}'::vector 
        WHERE id = '${newJob.id}'
      `);

      this.logger.log('Tạo Job và lưu Vector bằng AI thành công!');
    } catch (error) {
      // Dùng Try-Catch ở đây để lỡ Gemini hết hạn mức (Quota) hoặc API Key lỗi,
      // Hệ thống chỉ báo lỗi Log chứ KHÔNG làm sập API (vì DB đã lưu ở Bước 1 rồi)
      this.logger.error(
        'Cảnh báo: Lỗi khi gọi API Gemini nhúng Vector:',
        error,
      );
    }

    // ---------------------------------------------------------
    // BƯỚC 3: Trả dữ liệu về cho Controller
    // ---------------------------------------------------------
    return { job: newJob, scenario: newScenario };
  }

  // Cập nhật Job
  // Cập nhật Job kèm theo nhúng lại Vector và cập nhật Scenario
  async updateJob(
    id: string,
    creatorId: string,
    dto: CreateJobWithScenarioDto,
  ) {
    // 1. Kiểm tra quyền sở hữu và lấy thông tin Job kèm Scenario hiện tại
    const job = await this.prisma.jobDescription.findFirst({
      where: { id, creatorId },
      include: { scenarios: true }, // Lấy luôn bài test đang gắn với Job này
    });

    if (!job) throw new Error('Không tìm thấy Job hoặc bạn không có quyền sửa');

    // 2. Cập nhật dữ liệu vào DB (Dùng Transaction để an toàn)
    const updatedJob = await this.prisma.$transaction(async (tx) => {
      // 2.1 Cập nhật thông tin Job
      const updatedJD = await tx.jobDescription.update({
        where: { id },
        data: {
          title: dto.title,
          content: dto.content,
          hrEmail: dto.hrEmail ? dto.hrEmail : null,
        },
      });

      // 2.2 Cập nhật thông tin bài Test (Nếu job này đã có bài test)
      if (job.scenarios && job.scenarios.length > 0) {
        await tx.testScenario.update({
          where: { id: job.scenarios[0].id },
          data: {
            title: dto.scenarioTitle,
            difficulty: dto.difficulty,
            timeLimit: dto.timeLimit,
            context: dto.scenarioContext,
          },
        });
      }

      return updatedJD;
    });

    // 3. Gọi AI nhúng lại Vector cho JD mới
    try {
      this.logger.log(
        `Đang cập nhật lại Vector Embedding cho Job ID: ${id}...`,
      );

      const embeddingVector = await this.generateEmbedding(dto.content);
      const vectorString = `[${embeddingVector.join(',')}]`;

      // Cập nhật đè Vector mới vào Database
      await this.prisma.$executeRawUnsafe(`
        UPDATE "JobDescription" 
        SET "embedding" = '${vectorString}'::vector 
        WHERE id = '${id}'
      `);

      this.logger.log('Cập nhật Vector bằng AI thành công!');
    } catch (error) {
      // Bắt lỗi an toàn, lỡ AI lỗi thì DB vẫn cập nhật text thành công
      this.logger.error(
        'Cảnh báo: Lỗi khi gọi API Gemini nhúng Vector (Update):',
        error,
      );
    }

    return { message: 'Cập nhật chiến dịch thành công', job: updatedJob };
  }

  // Xóa Job
  async deleteJob(id: string, creatorId: string) {
    // Chỉ người tạo mới được xóa
    const job = await this.prisma.jobDescription.findFirst({
      where: { id, creatorId },
    });

    if (!job) throw new Error('Không tìm thấy Job hoặc bạn không có quyền xóa');

    return this.prisma.jobDescription.delete({
      where: { id },
    });
  }
}
