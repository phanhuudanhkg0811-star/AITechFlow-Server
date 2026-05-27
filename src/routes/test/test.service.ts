/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { EmailService } from 'src/shared/services/mail.service';
import { PrismaService } from 'src/shared/services/prisma.service';
import { AiService } from '../ai/ai.service';

export interface AssessmentReportData {
  finalCode: Record<string, string>;
  summary: string;
  evaluation: {
    score: number;
    passedRequirements: string[];
    failedRequirements: string[];
    generalFeedback: string;
  };
  notableCode: Array<{
    snippet: string;
    comment: string;
    type: 'outstanding' | 'warning' | 'complex';
  }>;
  copiedCode: Array<{
    fileName: string;
    textLength: number;
    snippet: string;
    timestamp: string;
  }>;
  tabSwitchCount: number;
  suggestedQuestions: string[];
}

@Injectable()
export class TestService {
  private readonly logger = new Logger(TestService.name);
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private aiService: AiService,
  ) {}

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

  async logIdeEvent(
    sessionId: string,
    eventType: 'PASTE_EVENT' | 'TAB_SWITCH',
    payload: any,
  ) {
    this.logger.warn(
      `User in session ${sessionId} triggered ${eventType} with payload: ${JSON.stringify(payload)}`,
    );
    return this.prisma.ideEvent.create({
      data: {
        sessionId,
        eventType,
        payload,
      },
    });
  }

  async submitAndTriggerGrading(
    sessionId: string,
    finalCode: any, // Chấp nhận cấu trúc phức tạp từ frontend
  ) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: {
        application: { include: { user: true, job: true } },
        scenario: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên thi');
    }

    // Các biến thông tin ứng viên dùng chung cho việc gửi mail
    const candidateEmail = session.application.user.email;
    const candidateName = session.application.user.name || 'Ứng viên';
    const jobTitle = session.application.job?.title || 'Vị trí ứng tuyển';

    // Lưu finalCode một cách an toàn
    await this.prisma.testSession.update({
      where: { id: sessionId },
      data: {
        endTime: new Date(),
        finalCode: finalCode as Prisma.InputJsonValue,
      },
    });

    // Lấy toàn bộ events về xử lý trên RAM để đảm bảo Type-Safe tuyệt đối
    const allEvents = await this.prisma.ideEvent.findMany({
      where: { sessionId: sessionId },
    });

    let tabSwitchCount = 0;
    const copiedCodeRecords: AssessmentReportData['copiedCode'] = [];

    for (const event of allEvents) {
      const payload = event.payload as Record<string, unknown> | null;

      if (event.eventType === 'TAB_SWITCH' && payload?.action === 'left_tab') {
        tabSwitchCount++;
      }

      if (event.eventType === 'PASTE_EVENT' && payload) {
        copiedCodeRecords.push({
          fileName: String(payload.fileName || 'Unknown'),
          textLength: Number(payload.textLength || 0),
          snippet: String(payload.snippet || ''),
          timestamp: String(payload.timestamp || event.createdAt.toISOString()),
        });
      }
    }

    // Lấy Report hiện tại (nếu có từ quá trình quét CV) để chuẩn bị merge
    const existingReport = await this.prisma.assessmentReport.findUnique({
      where: { applicationId: session.applicationId },
    });

    // 2. Kiểm tra gian lận
    const isCheated = tabSwitchCount >= 10 || copiedCodeRecords.length >= 3;

    if (isCheated) {
      await this.prisma.$transaction(async (tx) => {
        await tx.application.update({
          where: { id: session.applicationId },
          data: { status: 'REJECTED' },
        });

        const reason =
          tabSwitchCount >= 10
            ? 'Rời màn hình quá 10 lần'
            : 'Sao chép mã nguồn bên ngoài quá 3 lần';

        // Xử lý Merge Data cho trường hợp gian lận
        const newSummary = `Bài thi bị hủy tự động: ${reason}`;
        const finalSummary = existingReport
          ? `${existingReport.summary}\n\n=== KẾT QUẢ BÀI TEST ===\n${newSummary}`
          : newSummary;

        const riskData = {
          reason,
          tabSwitchCount,
          copiedCode: copiedCodeRecords,
        };

        const finalRiskFlags =
          existingReport && existingReport.riskFlags
            ? {
                ...(existingReport.riskFlags as Record<string, any>),
                ...riskData,
              }
            : riskData;

        await tx.assessmentReport.upsert({
          where: { applicationId: session.applicationId },
          update: {
            summary: finalSummary,
            cleanCodeScore: 0,
            architectureScore: 0,
            riskFlags: finalRiskFlags as Prisma.JsonObject,
          },
          create: {
            applicationId: session.applicationId,
            summary: newSummary,
            cleanCodeScore: 0,
            architectureScore: 0,
            riskFlags: riskData as Prisma.JsonObject,
            interviewQuestions: [] as Prisma.JsonArray,
          },
        });
      });

      return { message: 'Ứng viên bị loại do vi phạm quy chế anti-cheat.' };
    }

    // CHUẨN HÓA DỮ LIỆU CODE GỬI CHO AI
    const simplifiedCode: Record<string, string> = {};
    if (finalCode && typeof finalCode === 'object') {
      for (const path in finalCode) {
        if (
          path.startsWith('node_modules') ||
          path.startsWith('dist') ||
          path.startsWith('build') ||
          path.startsWith('.next') ||
          path.startsWith('.git')
        ) {
          continue;
        }

        if (
          Object.prototype.hasOwnProperty.call(finalCode, path) &&
          finalCode[path]?.file?.contents !== undefined
        ) {
          simplifiedCode[path] = finalCode[path].file.contents;
        }
      }
    }

    // 3. AI Chấm điểm
    try {
      const aiPrompt = `
        Bạn là chuyên gia Code Reviewer cấp cao. Hãy chấm điểm bài thi này.
        Đề bài: ${session.scenario.context}
        Mã nguồn bài làm: ${JSON.stringify(simplifiedCode)}

        Trả về chuẩn JSON (KHÔNG KÈM MARKDOWN):
        {
          "summary": "Tóm tắt giải pháp...",
          "evaluation": { "score": 85, "passedRequirements": [], "failedRequirements": [], "generalFeedback": "..." },
          "notableCode": [{ "snippet": "...", "comment": "...", "type": "outstanding" }],
          "suggestedQuestions": ["Câu 1..."]
        }
      `;

      const aiResponseString = await this.aiService.generateResult(aiPrompt);

      const cleanedJsonString = aiResponseString
        .replace(/^```(json)?\s*/, '')
        .replace(/```\s*$/, '')
        .trim();

      const aiAnalysis = JSON.parse(cleanedJsonString) as AssessmentReportData;

      // Xử lý Merge Data cho trường hợp làm bài bình thường
      const newSummary = aiAnalysis.summary;
      const finalSummary = existingReport
        ? `${existingReport.summary}\n\n=== KẾT QUẢ BÀI TEST ===\n${newSummary}`
        : newSummary;

      const riskData = {
        generalFeedback: aiAnalysis.evaluation.generalFeedback,
        tabSwitchCount: tabSwitchCount,
        copiedCode: copiedCodeRecords,
        notableCode: aiAnalysis.notableCode,
        failedRequirements: aiAnalysis.evaluation.failedRequirements,
        passedRequirements: aiAnalysis.evaluation.passedRequirements,
      };

      const finalRiskFlags =
        existingReport && existingReport.riskFlags
          ? {
              ...(existingReport.riskFlags as Record<string, any>),
              ...riskData,
            }
          : riskData;

      const finalQuestions =
        existingReport && Array.isArray(existingReport.interviewQuestions)
          ? [
              ...existingReport.interviewQuestions,
              ...aiAnalysis.suggestedQuestions,
            ]
          : aiAnalysis.suggestedQuestions;

      // 4. Upsert vào Database
      await this.prisma.assessmentReport.upsert({
        where: { applicationId: session.applicationId },
        update: {
          summary: finalSummary,
          cleanCodeScore: aiAnalysis.evaluation.score,
          architectureScore: aiAnalysis.evaluation.score,
          riskFlags: finalRiskFlags as unknown as Prisma.JsonObject,
          interviewQuestions: finalQuestions as unknown as Prisma.JsonArray,
        },
        create: {
          applicationId: session.applicationId,
          summary: newSummary,
          cleanCodeScore: aiAnalysis.evaluation.score,
          architectureScore: aiAnalysis.evaluation.score,
          riskFlags: riskData as unknown as Prisma.JsonObject,
          interviewQuestions:
            aiAnalysis.suggestedQuestions as unknown as Prisma.JsonArray,
        },
      });

      const isPassed = aiAnalysis.evaluation.score >= 65;

      // Cập nhật trạng thái Application dựa trên điểm số
      await this.prisma.application.update({
        where: { id: session.applicationId },
        data: { status: isPassed ? 'COMPLETED' : 'REJECTED' },
      });

      // LUỒNG XỬ LÝ GỬI EMAIL TỰ ĐỘNG
      if (isPassed) {
        // Gửi email chúc mừng nếu ĐẬU
        try {
          await this.emailService.sendTestPassedCongratulation(
            candidateEmail,
            candidateName,
            aiAnalysis.evaluation.score,
          );
          this.logger.log(
            `Đã gửi email chúc mừng thành công tới: ${candidateEmail}`,
          );
        } catch (mailError) {
          this.logger.error(
            `Lỗi không thể gửi email chúc mừng tới ${candidateEmail}:`,
            mailError,
          );
        }
      } else {
        // THÊM: Gửi email thông báo từ chối nếu TRƯỢT (Điểm < 65)
        try {
          await this.emailService.sendRejection(candidateEmail, jobTitle);
          this.logger.log(
            `Đã gửi email thông báo trượt tới: ${candidateEmail}`,
          );
        } catch (mailError) {
          this.logger.error(
            `Lỗi không thể gửi email từ chối tới ${candidateEmail}:`,
            mailError,
          );
        }
      }

      return {
        message: 'Quá trình phân tích và cập nhật trạng thái hoàn tất.',
      };
    } catch (error) {
      this.logger.error('Lỗi quy trình chấm điểm:', error);
      throw error;
    }
  }
}
