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

  async submitAndTriggerGrading(sessionId: string) {
    // 1. Lấy thông tin session và đóng băng phiên làm bài
    const session = await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        endTime: new Date(), // Chốt thời gian nộp bài
      },
      include: {
        application: true, // Join bảng Application để đổi trạng thái
      },
    });

    // 2. Cập nhật trạng thái của Application sang AI Đang Chấm (REVIEWING)
    await this.prisma.application.update({
      where: { id: session.applicationId },
      data: {
        status: 'REVIEWING', // Dùng đúng enum AppStatus bạn đã định nghĩa
      },
    });

    // 3. Kích hoạt Agentic AI chạy ngầm (Chỗ này bạn sẽ gọi logic LangChain/Gemini)
    // Lưu ý: Dùng async/await mà không cần return cái này ra Frontend để ứng viên không phải đợi AI chạy xong.
    // this.triggerAgenticAIGrading(sessionId).catch((err) => {
    //   console.error('Lỗi khi AI chấm bài tự động:', err);
    // });

    return {
      message: 'Nộp bài thành công. Luồng chấm điểm AI đã được kích hoạt.',
    };
  }

  //   // Hàm private giả lập luồng gọi Gemini
  //   private async triggerAgenticAIGrading(sessionId: string) {
  //     console.log(
  //       `[Agentic AI] Đang phân tích mã nguồn cho phiên ${sessionId}...`,
  //     );
  // TODO: Implement logic gửi finalCode, promptLogs, ideEvents vào Gemini 3.1 Pro ở đây
  //   }
}
