import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './routes/auth/auth.module';
import { TestModule } from './routes/test/test.module';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthenticationGuard } from './shared/guards/authentication.guard';
import CustomZodValidationPipe from './shared/pipes/zod-validator.pipe';
import { JobModule } from './routes/job/job.module';
import { DashboardModule } from './routes/dashboard/dashboard.module';
import { ApplicationModule } from './routes/application/application.module';
import { AiModule } from './routes/ai/ai.module';
import { ConversationModule } from './routes/conversation/conversation.module';

@Module({
  imports: [
    SharedModule,
    AuthModule,
    TestModule,
    JobModule,
    DashboardModule,
    ApplicationModule,
    AiModule,
    ConversationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard,
    },
    {
      provide: APP_PIPE, //global check
      useClass: CustomZodValidationPipe,
    },
  ],
})
export class AppModule {}
