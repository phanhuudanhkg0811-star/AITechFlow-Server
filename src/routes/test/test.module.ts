import { Module } from '@nestjs/common';
import { TestService } from './test.service';
import { TestsController } from './test.controller';
import { SharedModule } from 'src/shared/shared.module';

@Module({
  imports: [SharedModule],
  providers: [TestService],
  controllers: [TestsController],
})
export class TestModule {}
