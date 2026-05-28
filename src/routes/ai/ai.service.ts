/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import envConfig from 'src/shared/config';

@Injectable()
export class AiService {
  private genAI: GoogleGenerativeAI;
  private readonly logger = new Logger(AiService.name);

  constructor() {
    this.genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY);
  }

  async generateCodeSuggestion(payload: any, retries = 2): Promise<string> {
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
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3.1-flash-lite',
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      return responseText
        .replace(/```[\w]*\n/g, '')
        .replace(/```/g, '')
        .trim();
    } catch (error: any) {
      if ((error.status === 503 || error.status === 429) && retries > 0) {
        console.warn(
          `[AI] Google Server bận (${error.status}). Đang thử lại...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.generateCodeSuggestion(payload, retries - 1);
      }

      console.warn('[AI] Lỗi Suggestion hoặc hết Quota:', error.message);
      return '';
    }
  }

  async generateQuickEdit(payload: any): Promise<string> {
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
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3.1-flash-lite',
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      return responseText
        .replace(/```[\w]*\n/g, '')
        .replace(/```/g, '')
        .trim();
    } catch (error) {
      console.error('Lỗi AI Quick Edit:', error);
      return selectedCode;
    }
  }

  async generateResult(prompt: string): Promise<string> {
    this.logger.log('Bắt đầu gọi AI để chấm điểm bài thi...');
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3.1-flash-lite',
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      this.logger.log('AI đã chấm điểm xong.');
      return responseText;
    } catch (error) {
      this.logger.error('Lỗi khi gọi AI để chấm điểm:', error);
      // Re-throw the error so the calling service can handle it
      throw new Error('Quá trình chấm điểm của AI thất bại.');
    }
  }
}
