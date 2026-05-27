/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import envConfig from 'src/shared/config';

@Injectable()
export class AiService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY);
  }

  async generateCodeSuggestion(payload: any, retries = 2): Promise<string> {
    const {
      fileName,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      currentLine,
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
        model: 'gemini-3-flash-preview',
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      return responseText
        .replace(/```[\w]*\n/g, '')
        .replace(/```/g, '')
        .trim();
    } catch (error: any) {
      // Nếu vẫn muốn giữ retry, hãy giảm thời gian sleep xuống 1000ms (1 giây)
      if ((error.status === 503 || error.status === 429) && retries > 0) {
        console.warn(
          `[AI] Google Server bận (${error.status}). Đang thử lại...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.generateCodeSuggestion(payload, retries - 1);
      }

      // Nếu lỗi hoặc hết lượt thử lại -> Trả về chuỗi rỗng để ứng viên gõ tiếp
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
        model: 'gemini-3-flash-preview',
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
}
