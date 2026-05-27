import { Module } from '@nestjs/common';
import { TestService } from './test.service';
import { TestsController } from './test.controller';
import { SharedModule } from 'src/shared/shared.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [SharedModule, AiModule],
  providers: [TestService],
  controllers: [TestsController],
})
export class TestModule {}
