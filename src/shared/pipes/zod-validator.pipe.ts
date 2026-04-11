/* eslint-disable @typescript-eslint/no-unsafe-call */
import { UnprocessableEntityException } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';
import { ZodError } from 'zod'; // Bắt buộc phải import lại ZodError

const CustomZodValidationPipe = createZodValidationPipe({
  createValidationException: (error) => {
    // Ép kiểu (Type Assertion) error thành ZodError ở ngay đây
    const zodError = error as ZodError;
    const issues = zodError?.issues || [];

    const formattedErrors = issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : 'root',
      message: issue.message,
    }));

    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Dữ liệu đầu vào không hợp lệ',
      details: formattedErrors,
    });
  },
});

export default CustomZodValidationPipe;
