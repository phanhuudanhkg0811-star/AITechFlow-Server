/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from 'src/shared/services/prisma.service';
import envConfig from 'src/shared/config';
import { Conversation, Message } from 'src/generated/prisma/client';

@Injectable()
export class ConversationService {
  private genAI: GoogleGenerativeAI;
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {
    this.genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY || '');
  }

  async getConversationsByTest(testId: string): Promise<Conversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { testId },
      orderBy: { createdAt: 'desc' },
    });
    return conversations;
  }

  async createConversation(
    testId: string,
    title: string,
  ): Promise<Conversation> {
    const conversation = await this.prisma.conversation.create({
      data: { testId, title },
    });
    return conversation;
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });
    return conversation;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return messages;
  }

  // ĐÃ SỬA: Bổ sung tham số codebase và viết lại Prompt
  async sendMessage(
    conversationId: string,
    content: string,
    role: string,
    codebase?: { name: string; content: string }[],
  ): Promise<Message> {
    await this.prisma.message.create({
      data: { conversationId, content, role, status: 'completed' },
    });

    try {
      // Dùng model mạnh hơn cho logic coding (flash hoặc pro tùy bạn cấu hình)
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview', // Khuyến nghị dùng model tốt để code chính xác
      });

      const recentMessages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      const historyContext = recentMessages
        .reverse()
        .map(
          (msg: Message) =>
            `${msg.role === 'user' ? 'Ứng viên' : 'AI'}: ${msg.content}`,
        )
        .join('\n');

      // Tạo Context hiển thị các file ứng viên đang chọn
      const contextFiles =
        codebase && codebase.length > 0
          ? `[CÁC FILE ỨNG VIÊN ĐANG CHỌN ĐỂ HỎI]\n${codebase
              .map(
                (f) =>
                  `--- File: ${f.name} ---\n${f.content}\n-------------------`,
              )
              .join('\n\n')}`
          : '[Không có file nào được đính kèm]';

      const prompt = `Bạn là AI Tech Lead hỗ trợ ứng viên làm bài kiểm tra mã nguồn.
Hãy hướng dẫn, giải đáp ngắn gọn và súc tích.

QUY TẮC CUNG CẤP CODE:
- Nếu ứng viên yêu cầu sửa lỗi, tối ưu hoặc thêm chức năng, bạn PHẢI cung cấp TOÀN BỘ nội dung của file đó sau khi đã được chỉnh sửa (Full Rewrite).
- Việc cung cấp toàn bộ file giúp hệ thống Frontend ghi đè chính xác mà không bị lệch dòng.
- TRONG MỌI TRƯỜNG HỢP GỬI CODE MẪU HOẶC FILE, luôn sử dụng thẻ \`// file: <path>\` ở dòng ĐẦU TIÊN bên trong markdown code block.

Ví dụ định dạng bạn phải tuân thủ:
\`\`\`javascript
// file: src/main.ts
import { NestFactory } from '@nestjs/core';
// ... toàn bộ code đã hoàn thiện ...
\`\`\`

Ngữ cảnh mã nguồn hiện tại:
${contextFiles}

Lịch sử trò chuyện gần đây:
${historyContext}

Ứng viên: ${content}`;

      const result = await model.generateContent(prompt);
      const aiResponse = result.response.text();

      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          content: aiResponse,
          role: 'assistant',
          status: 'completed',
        },
      });

      return aiMessage;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Lỗi khi gọi AI Chat:', errorMessage);

      const failedMessage = await this.prisma.message.create({
        data: {
          conversationId,
          content: 'Hệ thống AI đang quá tải hoặc lỗi. Vui lòng thử lại sau.',
          role: 'assistant',
          status: 'failed',
        },
      });

      return failedMessage;
    }
  }
}
