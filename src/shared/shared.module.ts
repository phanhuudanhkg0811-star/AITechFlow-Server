import { Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthService } from './services/jwt.service';
import { AuthenticationGuard } from './guards/authentication.guard';
import { RolesGuard } from './guards/role.guard';
import { AccessTokenGuard } from './guards/jwt.guard';
import { EmailService } from './services/mail.service';
import { CryptoService } from './services/crypto.service';
import { TenantGuard } from './guards/tenant.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    PrismaService,
    JwtAuthService,
    AuthenticationGuard,
    RolesGuard,
    AccessTokenGuard,
    EmailService,
    CryptoService,
    TenantGuard,
  ],
  exports: [
    PrismaService,
    JwtAuthService,
    AuthenticationGuard,
    RolesGuard,
    AccessTokenGuard,
    EmailService,
    CryptoService,
    TenantGuard,
  ],
})
export class SharedModule {}
