import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { AiModule } from '../ai/ai.module';
import { EmailAccountController } from './email-account.controller';
import { EmailAccountService } from './email-account.service';

@Module({
  imports: [SharedModule, AiModule],
  controllers: [EmailAccountController],
  providers: [EmailAccountService],
})
export class EmailAccountModule {}
