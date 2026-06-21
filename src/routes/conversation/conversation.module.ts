import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { SharedModule } from 'src/shared/shared.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [SharedModule, AiModule],
  providers: [ConversationService],
  controllers: [ConversationController],
})
export class ConversationModule {}
