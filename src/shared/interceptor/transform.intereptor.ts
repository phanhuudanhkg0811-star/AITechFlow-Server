/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response as ExpressResponse } from 'express';

export interface Response<T> {
  statusCode: number;
  message: string;
  data?: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((res: any): Response<T> => {
        const ctx = context.switchToHttp();
        const response = ctx.getResponse<ExpressResponse>();
        const statusCode = response.statusCode;

        // Trường hợp 1: Controller không trả về gì (VD: Delete thành công)
        if (res === undefined || res === null) {
          return { statusCode, message: 'Success' };
        }

        // Trường hợp 2: Controller chủ động trả về { message: '...', data: ... }
        if (
          typeof res === 'object' &&
          'message' in res &&
          typeof res.message === 'string'
        ) {
          const formattedResponse: Response<T> = {
            statusCode,
            message: res.message,
          };

          // Chỉ gắn thêm 'data' nếu Controller thực sự có truyền 'data'
          if ('data' in res && res.data !== undefined) {
            formattedResponse.data = res.data;
          }
          return formattedResponse;
        }

        // Trường hợp 3: Controller trả về Data thuần túy (Mảng, Object User, String,...)
        return {
          statusCode,
          message: 'Success',
          data: res,
        };
      }),
    );
  }
}
