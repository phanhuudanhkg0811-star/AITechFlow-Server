import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GithubStrategy } from './github.strategy';
import { SharedModule } from 'src/shared/shared.module';
import { AuthRepository } from './auth.repository';

@Module({
  imports: [SharedModule],
  controllers: [AuthController],
  providers: [AuthService, GithubStrategy, AuthRepository, GithubStrategy],
})
export class AuthModule {}
