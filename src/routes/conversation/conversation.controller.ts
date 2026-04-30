import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ConversationService } from './conversation.service';

@Controller()
export class ConversationController {
  constructor(private readonly conversationsService: ConversationService) {}

  // 1. Lấy danh sách hội thoại theo bài test
  @Get('tests/:testId/conversations')
  getConversationsByTest(@Param('testId') testId: string) {
    return this.conversationsService.getConversationsByTest(testId);
  }

  // 2. Tạo hội thoại mới
  @Post('conversations')
  createConversation(@Body() body: { testId: string; title: string }) {
    return this.conversationsService.createConversation(
      body.testId,
      body.title,
    );
  }

  // 3. Lấy thông tin 1 hội thoại
  @Get('conversations/:id')
  getConversationById(@Param('id') id: string) {
    return this.conversationsService.getConversationById(id);
  }

  // 4. Lấy lịch sử tin nhắn
  @Get('conversations/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.conversationsService.getMessages(id);
  }

  // 5. Gửi tin nhắn mới & Nhận phản hồi từ AI
  @Post('conversations/:id/messages')
  sendMessage(
    @Param('id') conversationId: string,
    @Body()
    body: {
      content: string;
      role: string;
      codebase?: { name: string; content: string }[];
    },
  ) {
    return this.conversationsService.sendMessage(
      conversationId,
      body.content,
      body.role,
      body.codebase,
    );
  }
}
