import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobsController } from './job.controller';
import { SharedModule } from 'src/shared/shared.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [SharedModule, AiModule],
  providers: [JobService],
  controllers: [JobsController],
})
export class JobModule {}
