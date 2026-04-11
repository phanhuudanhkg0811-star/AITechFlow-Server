import { Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthService } from './services/jwt.service';
import { AuthenticationGuard } from './guards/authentication.guard';
import { RolesGuard } from './guards/role.guard';
import { AccessTokenGuard } from './guards/jwt.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    PrismaService,
    JwtAuthService,
    AuthenticationGuard,
    RolesGuard,
    AccessTokenGuard,
  ],
  exports: [
    PrismaService,
    JwtAuthService,
    AuthenticationGuard,
    RolesGuard,
    AccessTokenGuard,
  ],
})
export class SharedModule {}
