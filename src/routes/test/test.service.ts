import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class TestService {
  constructor(private prisma: PrismaService) {}

  async renameTestScenario(sessionId: string, newTitle: string) {
    if (!newTitle || newTitle.trim() === '') {
      throw new BadRequestException('Tiêu đề không được để trống');
    }

    // 1. Tìm phiên thi để lấy ID của Scenario
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      select: { scenarioId: true },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên làm bài này');
    }

    // 2. Cập nhật tên của TestScenario
    const updatedScenario = await this.prisma.testScenario.update({
      where: { id: session.scenarioId },
      data: { title: newTitle },
    });

    return {
      message: 'Đổi tên thành công',
      scenario: updatedScenario,
    };
  }

  async getTestSession(sessionId: string) {
    let session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        scenario: {
          select: {
            title: true,
            difficulty: true,
            timeLimit: true,
            context: true,
            initialCode: true,
          },
        },
        application: {
          select: {
            status: true,
            job: { select: { title: true } },
            user: { select: { name: true, email: true, githubUsername: true } },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên làm bài này');
    }

    // NẾU CHƯA CÓ THỜI GIAN BẮT ĐẦU -> CHỐT GIỜ NGAY LÚC NÀY (BẮT ĐẦU TÍNH GIỜ)
    if (!session.startTime) {
      session = await this.prisma.testSession.update({
        where: { id: sessionId },
        data: { startTime: new Date() },
        include: {
          scenario: {
            select: {
              title: true,
              difficulty: true,
              timeLimit: true,
              context: true,
              initialCode: true,
            },
          },
          application: {
            select: {
              status: true,
              job: { select: { title: true } },
              user: {
                select: { name: true, email: true, githubUsername: true },
              },
            },
          },
        },
      });
    }

    return session;
  }

  //   // Hàm private giả lập luồng gọi Gemini
  //   private async triggerAgenticAIGrading(sessionId: string) {
  //     console.log(
  //       `[Agentic AI] Đang phân tích mã nguồn cho phiên ${sessionId}...`,
  //     );
  // TODO: Implement logic gửi finalCode, promptLogs, ideEvents vào Gemini 3.1 Pro ở đây
  //   }

  // Thêm tham số finalCode vào đây
  async submitAndTriggerGrading(sessionId: string, finalCode: any) {
    const session = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        endTime: new Date(),
        finalCode: finalCode, // Lưu toàn bộ mã nguồn vào DB để AI chấm
      },
      include: {
        application: true,
      },
    });

    await this.prisma.application.update({
      where: { id: session.applicationId },
      data: {
        status: 'REVIEWING',
      },
    });

    // ... (Phần logic gọi Agentic AI chấm điểm của bạn giữ nguyên)

    return {
      message: 'Nộp bài thành công. Luồng chấm điểm AI đã được kích hoạt.',
    };
  }
}
