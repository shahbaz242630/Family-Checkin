import { Module } from '@nestjs/common';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AppConfigService } from '../../shared/config/app-config.service';
import { PrismaUsersRepository } from './prisma-users.repository';
import { UsersService } from './users.service';
import { USERS_REPOSITORY } from './users.tokens';

@Module({
  providers: [
    PrismaService,
    {
      provide: USERS_REPOSITORY,
      useClass: PrismaUsersRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    {
      provide: UsersService,
      useFactory: (usersRepository, cryptoService) => new UsersService(usersRepository, cryptoService),
      inject: [USERS_REPOSITORY, CryptoService],
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
