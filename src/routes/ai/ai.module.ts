import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiPipelineService } from './ai-pineline.service';
import { CvScreeningService } from './ai-cv-screening.service';
import { SharedModule } from 'src/shared/shared.module';

@Module({
  imports: [SharedModule],
  providers: [AiService, AiPipelineService, CvScreeningService],
  controllers: [AiController],
})
export class AiModule {}
