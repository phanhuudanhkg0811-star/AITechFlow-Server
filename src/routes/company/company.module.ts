import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [SharedModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
