import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

@Module({
  imports: [SharedModule],
  controllers: [TemplateController],
  providers: [TemplateService],
})
export class TemplateModule {}
