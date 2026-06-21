/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import envConfig from 'src/shared/config';
import { CryptoService } from 'src/shared/services/crypto.service';
import { PrismaService } from 'src/shared/services/prisma.service';

interface AiCallContext {
  userId?: string;
  companyId?: string;
  testId?: string;
  enforceSuggestionToggle?: boolean;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async generateCodeSuggestion(
    payload: any,
    context: AiCallContext = {},
    retries = 2,
  ): Promise<string> {
    const {
      fileName,
      textBeforeCursor,
      textAfterCursor,
      previousLines,
      nextLines,
    } = payload;

    const prompt = `
      You are an expert AI coding assistant. Complete the code for the file "${fileName}".
      Only output the EXACT code that should be inserted at the cursor position.
      Do NOT wrap the code in markdown blocks (\`\`\`). Do NOT explain.

      Previous lines:
      ${previousLines}

      Current line before cursor: ${textBeforeCursor}[CURSOR]${textAfterCursor}

      Next lines:
      ${nextLines}
    `;

    try {
      const { model, companyId } = await this.getModel({
        ...context,
        testId: context.testId ?? payload.testId,
        enforceSuggestionToggle: true,
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const cleaned = responseText
        .replace(/```[\w]*\n/g, '')
        .replace(/```/g, '')
        .trim();

      await this.trackUsage(companyId, prompt, cleaned);

      return cleaned;
    } catch (error: any) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      if ((error.status === 503 || error.status === 429) && retries > 0) {
        console.warn(`[AI] Google busy (${error.status}). Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.generateCodeSuggestion(payload, context, retries - 1);
      }

      console.warn('[AI] Suggestion failed or quota exhausted:', error.message);
      return '';
    }
  }

  async generateQuickEdit(
    payload: any,
    context: AiCallContext = {},
  ): Promise<string> {
    const { selectedCode, fullCode, instruction } = payload;

    const prompt = `
      You are an expert AI developer. Rewrite the following selected code based on the instruction.
      Instruction: ${instruction}

      Selected code to rewrite:
      ${selectedCode}

      Context (Full Code):
      ${fullCode}

      Output ONLY the modified code that will replace the selected code.
      Do NOT include markdown formatting (\`\`\`). Do NOT include explanations.
    `;

    try {
      const { model, companyId } = await this.getModel({
        ...context,
        testId: context.testId ?? payload.testId,
        enforceSuggestionToggle: true,
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const cleaned = responseText
        .replace(/```[\w]*\n/g, '')
        .replace(/```/g, '')
        .trim();

      await this.trackUsage(companyId, prompt, cleaned);

      return cleaned;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      console.error('AI quick edit failed:', error);
      return selectedCode;
    }
  }

  async generateResult(
    prompt: string,
    context: AiCallContext = {},
  ): Promise<string> {
    this.logger.log('Calling AI to grade submitted test...');

    try {
      const { model, companyId } = await this.getModel(context, {
        json: true,
      });
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      await this.trackUsage(companyId, prompt, responseText);

      this.logger.log('AI grading completed.');
      return responseText;
    } catch (error) {
      this.logger.error('AI grading failed:', error);
      throw new Error('AI grading failed.');
    }
  }

  async generateText(
    prompt: string,
    context: AiCallContext = {},
  ): Promise<string> {
    const { model, companyId } = await this.getModel(context);
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    await this.trackUsage(companyId, prompt, responseText);

    return responseText;
  }

  async generateEmbedding(
    text: string,
    context: AiCallContext = {},
  ): Promise<number[]> {
    const { model, companyId } = await this.getModel(context, {
      modelName: 'gemini-embedding-001',
    });
    const result = await model.embedContent(text);

    await this.trackUsage(companyId, text, '');

    return result.embedding.values;
  }

  private async getModel(
    context: AiCallContext,
    options: { json?: boolean; modelName?: string } = {},
  ) {
    const company = await this.resolveCompany(context);
    const apiKey = company?.id
      ? await this.resolveApiKey(company.id)
      : envConfig.SECRET_API_KEY;

    if (company && context.enforceSuggestionToggle === true) {
      this.assertAiSuggestionEnabled(company.aiSuggestionEnabled);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.modelName ?? 'gemini-3.1-flash-lite',
      generationConfig: options.json
        ? {
            responseMimeType: 'application/json',
          }
        : undefined,
    });

    return { model, companyId: company?.id };
  }

  private async resolveCompany(context: AiCallContext) {
    if (context.companyId) {
      return this.prisma.company.findUnique({
        where: { id: context.companyId },
        select: this.companySelect(),
      });
    }

    if (context.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: context.userId },
        select: {
          company: { select: this.companySelect() },
        },
      });

      if (user?.company) return user.company;
    }

    if (context.testId) {
      const session = await this.prisma.testSession.findUnique({
        where: { id: context.testId },
        select: {
          application: {
            select: {
              job: {
                select: {
                  company: { select: this.companySelect() },
                },
              },
            },
          },
        },
      });

      return session?.application.job.company ?? null;
    }

    return null;
  }

  async resolveApiKey(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { apiKey: true },
    });

    return company?.apiKey
      ? this.cryptoService.decrypt(company.apiKey)
      : envConfig.SECRET_API_KEY;
  }

  async recordExternalUsage(
    companyId: string | undefined,
    prompt: string,
    response: string,
  ) {
    await this.trackUsage(companyId, prompt, response);
  }

  private assertAiSuggestionEnabled(enabled: boolean) {
    if (!enabled) {
      throw new ForbiddenException(
        'AI Suggestions are disabled by your company administrator.',
      );
    }
  }

  private async trackUsage(
    companyId: string | undefined,
    prompt: string,
    response: string,
  ) {
    if (!companyId) return;

    const estimatedTokens = Math.max(
      1,
      Math.ceil((prompt.length + response.length) / 4),
    );

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        tokenUsage: { increment: estimatedTokens },
      },
    });
  }

  private companySelect() {
    return {
      id: true,
      apiKey: true,
      aiSuggestionEnabled: true,
    } as const;
  }
}
