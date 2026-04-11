import * as dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TransformInterceptor } from './shared/interceptor/transform.intereptor';

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function () {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({
    origin: process.env.GITHUB_CLIENT_URL || 'http://localhost:3000', // Chỉ định rõ URL của Frontend
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
