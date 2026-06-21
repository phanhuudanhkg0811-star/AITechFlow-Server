/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AiService } from './ai.service';
import { Roles } from 'src/shared/decorators/role.decorator';
import { RolesGuard } from 'src/shared/guards/role.guard';
import { AiPipelineService } from './ai-pineline.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiPipelineService: AiPipelineService,
  ) {}

  @Post('suggestion')
  async getSuggestion(
    @Body() body: any,
    @Req() req: Request & { user: { sub: string } },
  ) {
    const suggestion = await this.aiService.generateCodeSuggestion(body, {
      userId: req.user.sub,
      testId: body?.testId,
    });
    return { suggestion };
  }

  @Post('quick-edit')
  async quickEdit(
    @Body() body: any,
    @Req() req: Request & { user: { sub: string } },
  ) {
    const editedCode = await this.aiService.generateQuickEdit(body, {
      userId: req.user.sub,
      testId: body?.testId,
    });
    return { editedCode };
  }

  @Post('trigger-pipeline')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @UseGuards(RolesGuard)
  triggerPipelineManually() {
    // Bỏ async/await ở hàm này để request trả về luôn lập tức (non-blocking)
    // Gọi đúng tên hàm handleIncomingApplications() của bạn
    this.aiPipelineService.handleIncomingApplications().catch((err) => {
      console.error('Lỗi khi chạy thủ công AI Pipeline:', err);
    });

    return {
      success: true,
      message:
        'AI Pipeline đã được kích hoạt chạy ngầm. Hệ thống đang quét hòm thư...',
    };
  }
}
