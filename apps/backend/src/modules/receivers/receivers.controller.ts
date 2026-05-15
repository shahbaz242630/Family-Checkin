import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SensitiveAction } from '@prisma/client';
import type { Channel, RelationshipType, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { StepUpService } from '../account/step-up.service';
import { BackupContactsService } from '../backup-contacts/backup-contacts.service';
import { BillingService } from '../billing/billing.service';
import { UsersService } from '../users/users.service';
import { ReceiverConsentService } from './receiver-consent.service';
import { ReceiversService } from './receivers.service';

const PAID_ACCESS_REQUIRED_CODE = 'PAID_ACCESS_REQUIRED';
const PAID_ACCESS_REQUIRED_MESSAGE = 'Active subscription required to add receivers';

interface CreateReceiverBody {
  name?: string;
  phone?: string;
  phoneCountry?: string;
  countryCode?: string;
  relationshipType?: RelationshipType;
  language?: string;
  timezone?: string;
  techProfile?: TechProfile;
  primaryChannel?: Channel;
  fallbackChannels?: Channel[];
  scheduleFrequency?: string;
  scheduleTimeWindow?: Prisma.InputJsonObject;
  scheduleCustomCron?: string;
  personalNote?: string;
}

interface UpdateReceiverBody {
  name?: string;
  countryCode?: string;
  relationshipType?: RelationshipType;
  language?: string;
  timezone?: string;
  techProfile?: TechProfile;
  primaryChannel?: Channel;
  fallbackChannels?: Channel[];
  scheduleFrequency?: string;
  scheduleTimeWindow?: Prisma.InputJsonObject;
  scheduleCustomCron?: string;
}

interface PauseReceiverBody {
  pausedUntil?: string;
}

@Controller('receivers')
export class ReceiversController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: SupabaseAuthService,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(ReceiversService)
    private readonly receiversService: ReceiversService,
    @Inject(ReceiverConsentService)
    private readonly receiverConsentService: ReceiverConsentService,
    @Optional()
    @Inject(BackupContactsService)
    private readonly backupContactsService?: Pick<BackupContactsService, 'listForReceiver'>,
    @Inject(BillingService)
    private readonly billingService?: Pick<BillingService, 'getBillingStatus'>,
    @Optional()
    @Inject(StepUpService)
    private readonly stepUpService?: Pick<StepUpService, 'consumeStepUpToken'>,
  ) {}

  @Get()
  async list(@Headers('authorization') authorization: string | undefined) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receivers = await this.receiversService.listForSender(sender.id);

    return { receivers };
  }

  @Get(':receiverId')
  async detail(@Headers('authorization') authorization: string | undefined, @Param('receiverId') receiverId: string) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.getForSender({ userId: sender.id, receiverId });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    const backupContacts =
      (await this.backupContactsService?.listForReceiver({
        userId: sender.id,
        receiverId,
      })) ?? [];

    return {
      receiver: {
        ...receiver,
        backupContacts,
        escalation: {
          configured: backupContacts.length > 0,
          nextStep: backupContacts.length > 0 ? 'Backup contacts configured' : 'Add backup contacts',
        },
      },
    };
  }

  @Patch(':receiverId/pause')
  async pause(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Body() body: PauseReceiverBody = {},
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.pauseForSender({
      userId: sender.id,
      receiverId,
      pausedUntil: this.optionalDate(body.pausedUntil, 'pausedUntil must be a valid date'),
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    return { receiver };
  }

  @Patch(':receiverId/resume')
  async resume(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.resumeForSender({
      userId: sender.id,
      receiverId,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    return { receiver };
  }

  @Patch(':receiverId')
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Body() body: UpdateReceiverBody,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.updateForSender({
      userId: sender.id,
      receiverId,
      name: body.name ?? '',
      countryCode: body.countryCode ?? '',
      relationshipType: this.required(body.relationshipType, 'Receiver relationship type is required'),
      language: body.language ?? '',
      timezone: body.timezone ?? '',
      techProfile: this.required(body.techProfile, 'Receiver tech profile is required'),
      primaryChannel: this.required(body.primaryChannel, 'Receiver primary channel is required'),
      fallbackChannels: body.fallbackChannels ?? [],
      scheduleFrequency: body.scheduleFrequency ?? '',
      scheduleTimeWindow: body.scheduleTimeWindow ?? {},
      scheduleCustomCron: body.scheduleCustomCron,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    return { receiver };
  }

  @Delete(':receiverId')
  async delete(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-nearby-step-up-token') stepUpToken: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    await this.consumeReceiverRemoveStepUp(sender.id, stepUpToken);
    const receiver = await this.receiversService.deleteForSender({
      userId: sender.id,
      receiverId,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    return { receiver };
  }

  @Patch(':receiverId/check-ins/:checkInId/resolve')
  async resolveCheckIn(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Param('checkInId') checkInId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.resolveCheckInForSender({
      userId: sender.id,
      receiverId,
      checkInId,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Check-in not found');
    }

    return { receiver };
  }

  @Patch(':receiverId/check-ins/:checkInId/alert-backup')
  async alertBackupForCheckIn(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Param('checkInId') checkInId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.alertBackupForSender({
      userId: sender.id,
      receiverId,
      checkInId,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Check-in not found');
    }

    return { receiver };
  }

  @Patch(':receiverId/check-ins/:checkInId/try-later')
  async tryCheckInLater(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
    @Param('checkInId') checkInId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.tryCheckInLaterForSender({
      userId: sender.id,
      receiverId,
      checkInId,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    if (!receiver) {
      throw new NotFoundException('Check-in not found');
    }

    return { receiver };
  }

  @Post()
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Body() body: CreateReceiverBody,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const billingStatus = await this.billingService?.getBillingStatus(sender.id);

    if (!billingStatus?.entitled) {
      throw new ForbiddenException({
        code: PAID_ACCESS_REQUIRED_CODE,
        message: PAID_ACCESS_REQUIRED_MESSAGE,
      });
    }

    const receiver = await this.receiversService.createForSender({
      userId: sender.id,
      name: body.name ?? '',
      phone: body.phone ?? '',
      phoneCountry: body.phoneCountry,
      countryCode: body.countryCode ?? '',
      relationshipType: this.required(body.relationshipType, 'Receiver relationship type is required'),
      language: body.language ?? '',
      timezone: body.timezone ?? '',
      techProfile: this.required(body.techProfile, 'Receiver tech profile is required'),
      primaryChannel: this.required(body.primaryChannel, 'Receiver primary channel is required'),
      fallbackChannels: body.fallbackChannels ?? [],
      scheduleFrequency: body.scheduleFrequency ?? '',
      scheduleTimeWindow: body.scheduleTimeWindow ?? {},
      scheduleCustomCron: body.scheduleCustomCron,
      personalNote: body.personalNote,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });
    await this.receiverConsentService.requestConsent({
      receiver,
      actorUserId: sender.id,
      senderDisplayName: identity.email,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });

    return {
      receiver: {
        id: receiver.id,
        consentStatus: receiver.consentStatus,
        countryCode: receiver.countryCode,
        relationshipType: receiver.relationshipType,
        language: receiver.language,
        timezone: receiver.timezone,
        techProfile: receiver.techProfile,
        primaryChannel: receiver.primaryChannel,
        fallbackChannels: receiver.fallbackChannels,
        scheduleFrequency: receiver.scheduleFrequency,
        scheduleTimeWindow: receiver.scheduleTimeWindow,
        consentRequestStatus: 'requested',
      },
    };
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

  private async consumeReceiverRemoveStepUp(userId: string, stepUpToken: string | undefined): Promise<void> {
    const token = stepUpToken?.trim();
    if (!token) {
      throw new ForbiddenException('Step-up verification is required');
    }
    if (!this.stepUpService) {
      throw new ForbiddenException('Step-up verification is required');
    }

    await this.stepUpService.consumeStepUpToken({
      userId,
      action: SensitiveAction.REMOVE_RECEIVER,
      stepUpToken: token,
    });
  }

  private optionalDate(value: string | undefined, message: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(message);
    }

    return date;
  }

  private required<T>(value: T | undefined, message: string): T {
    if (!value) {
      throw new Error(message);
    }

    return value;
  }
}
