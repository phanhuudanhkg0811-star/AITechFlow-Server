import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobsController } from './job.controller';
import { SharedModule } from 'src/shared/shared.module';

@Module({
  imports: [SharedModule],
  providers: [JobService],
  controllers: [JobsController],
})
export class JobModule {}
