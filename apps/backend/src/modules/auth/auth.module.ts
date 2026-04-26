import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { SupabaseAuthService } from './supabase-auth.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [SupabaseAuthService],
  exports: [SupabaseAuthService],
})
export class AuthModule {}
