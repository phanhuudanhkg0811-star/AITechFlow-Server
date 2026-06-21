/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, Logger } from '@nestjs/common';
import { Conversation, Message } from 'src/generated/prisma/client';
import { PrismaService } from 'src/shared/services/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  getConversationsByTest(testId: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: { testId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createConversation(testId: string, title: string): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: { testId, title },
    });
  }

  getConversationById(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }

  getMessages(conversationId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendMessage(
    conversationId: string,
    content: string,
    role: string,
    codebase?: { name: string; content: string }[],
  ): Promise<Message> {
    await this.prisma.message.create({
      data: { conversationId, content, role, status: 'completed' },
    });

    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { testId: true },
      });

      const recentMessages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      const historyContext = recentMessages
        .reverse()
        .map(
          (msg: Message) =>
            `${msg.role === 'user' ? 'Candidate' : 'AI'}: ${msg.content}`,
        )
        .join('\n');

      const contextFiles =
        codebase && codebase.length > 0
          ? `[SELECTED CANDIDATE FILES]\n${codebase
              .map(
                (file) =>
                  `--- File: ${file.name} ---\n${file.content}\n-------------------`,
              )
              .join('\n\n')}`
          : '[No files attached]';

      const prompt = `You are an AI Tech Lead helping a candidate during a coding test.
Guide them concisely and helpfully.

CODE OUTPUT RULES:
- If the candidate asks for a bug fix, optimization, or feature, provide the full rewritten file content.
- Full file rewrites help the frontend replace content accurately.
- For any sample/file code, put \`// file: <path>\` as the first line inside the markdown code block.

Current code context:
${contextFiles}

Recent conversation:
${historyContext}

Candidate: ${content}`;

      const aiResponse = await this.aiService.generateText(prompt, {
        testId: conversation?.testId,
      });

      return this.prisma.message.create({
        data: {
          conversationId,
          content: aiResponse,
          role: 'assistant',
          status: 'completed',
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('AI chat failed:', errorMessage);

      return this.prisma.message.create({
        data: {
          conversationId,
          content: 'The AI assistant is overloaded or unavailable. Please try again later.',
          role: 'assistant',
          status: 'failed',
        },
      });
    }
  }
}
