import { Controller, Post } from '@nestjs/common';
import { AiPipelineService } from './ai-pineline.service';
import { IsPublic } from 'src/shared/decorators/auth.decorator';

@Controller('ai')
export class AiController {
  constructor(private readonly aiPipelineService: AiPipelineService) {}

  // API này dùng để test thủ công
  @Post('trigger-pipeline')
  @IsPublic()
  async triggerPipeline() {
    await this.aiPipelineService.handleIncomingApplications();
    return {
      message: 'Đã kích hoạt luồng quét CV thành công! Hãy xem log ở Terminal.',
    };
  }
}
