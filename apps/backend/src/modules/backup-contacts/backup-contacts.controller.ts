import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import { BackupContactsService } from './backup-contacts.service';

interface CreateBackupContactBody {
  name?: string;
  phone?: string;
  phoneCountry?: string;
  relationshipToReceiver?: string;
  locationInstructions?: string;
}

interface UpdateBackupContactBody {
  name?: string;
  phone?: string;
  phoneCountry?: string;
  relationshipToReceiver?: string;
  locationInstructions?: string;
}

@Controller('receivers/:receiverId/backup-contacts')
export class BackupContactsController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: SupabaseAuthService,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(BackupContactsService)
    private readonly backupContactsService: BackupContactsService,
  ) {}

  @Get()
  async list(@Headers('authorization') authorization: string | undefined, @Param('receiverId') receiverId: string) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const backupContacts = await this.backupContactsService.listForReceiver({
      userId: sender.id,
      receiverId,
    });

    if (!backupContacts) {
      throw new NotFoundException('Receiver not found');
    }

    return { backupContacts };
  }

  @Post()
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Body() body: CreateBackupContactBody,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const backupContact = await this.backupContactsService.createForReceiver({
      userId: sender.id,
      receiverId,
      name: body.name ?? '',
      phone: body.phone ?? '',
      phoneCountry: body.phoneCountry,
      relationshipToReceiver: body.relationshipToReceiver ?? '',
      locationInstructions: body.locationInstructions,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!backupContact) {
      throw new NotFoundException('Receiver not found');
    }

    return { backupContact };
  }

  @Patch(':backupContactId')
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Param('backupContactId') backupContactId: string,
    @Body() body: UpdateBackupContactBody,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const backupContact = await this.backupContactsService.updateForReceiver({
      userId: sender.id,
      receiverId,
      backupContactId,
      name: body.name ?? '',
      phone: body.phone,
      phoneCountry: body.phoneCountry,
      relationshipToReceiver: body.relationshipToReceiver ?? '',
      locationInstructions: body.locationInstructions,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!backupContact) {
      throw new NotFoundException('Backup contact not found');
    }

    return { backupContact };
  }

  @Delete(':backupContactId')
  async delete(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Param('backupContactId') backupContactId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const backupContact = await this.backupContactsService.deleteForReceiver({
      userId: sender.id,
      receiverId,
      backupContactId,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!backupContact) {
      throw new NotFoundException('Backup contact not found');
    }

    return { backupContact };
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    return token;
  }

  private firstForwardedIp(forwardedFor: string | undefined): string | undefined {
    return forwardedFor?.split(',')[0]?.trim() || undefined;
  }
}
