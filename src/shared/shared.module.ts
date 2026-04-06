import { Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule.register({})],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class SharedModule {}
