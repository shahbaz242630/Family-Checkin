import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
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
import { NEUTRAL_SENDER_DISPLAY_NAME } from '../channels/message-catalog.templates';
import { UsersService } from '../users/users.service';
import { ReceiverScheduleValidationError } from '../../shared/schedule/receiver-schedule';
import { ReceiverConsentService } from './receiver-consent.service';
import { ReceiverRequestError, RESOLUTION_NOTE_TOO_LONG_MESSAGE } from './receiver-policy';
import { PERSONAL_NOTE_TOO_LONG_MESSAGE, ReceiversService } from './receivers.service';

const PAID_ACCESS_REQUIRED_CODE = 'PAID_ACCESS_REQUIRED';
const PAID_ACCESS_REQUIRED_MESSAGE = 'Active subscription required to add receivers';
const RECEIVER_VALIDATION_MESSAGES = new Set([
  'Sender user id is required',
  'Receiver id is required',
  'Receiver name is required',
  'Receiver phone is required',
  'Receiver primary channel is required',
  'Receiver country code is required',
  'Receiver language is required',
  'Receiver timezone is required',
  'Receiver schedule frequency is required',
  'Invalid phone number',
  PERSONAL_NOTE_TOO_LONG_MESSAGE,
  RESOLUTION_NOTE_TOO_LONG_MESSAGE,
]);

/** Whether the consent invitation actually left; `failed` tells the app to offer "Send again" (CB-009). */
type ConsentRequestStatus = 'requested' | 'failed';

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

interface ResolveCheckInBody {
  note?: string;
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
    const receiver = await this.mapReceiverValidationFailure(() =>
      this.receiversService.updateForSender({
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
      }),
    );

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
    @Body() body: ResolveCheckInBody = {},
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.mapReceiverValidationFailure(() =>
      this.receiversService.resolveCheckInForSender({
        userId: sender.id,
        receiverId,
        checkInId,
        note: this.optionalText(body.note),
        ipAddress: this.firstForwardedIp(forwardedFor),
        userAgent,
      }),
    );

    if (!receiver) {
      throw new NotFoundException('Check-in not found');
    }

    return { receiver };
  }

  @Post(':receiverId/consent/resend')
  async resendConsent(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const result = await this.mapReceiverValidationFailure(() =>
      this.receiverConsentService.resendConsent({
        userId: sender.id,
        receiverId,
        senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME,
        ipAddress: this.firstForwardedIp(forwardedFor),
        userAgent,
      }),
    );

    if (!result) {
      throw new NotFoundException('Receiver not found');
    }

    const consentRequestStatus: ConsentRequestStatus = result.sent ? 'requested' : 'failed';

    return {
      receiver: {
        id: result.receiver.id,
        consentStatus: result.receiver.consentStatus,
        consentRequestStatus,
        consentRequestedAt: result.receiver.consentRequestedAt?.toISOString(),
      },
    };
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
    const receiver = await this.mapReceiverValidationFailure(() =>
      this.receiversService.alertBackupForSender({
        userId: sender.id,
        receiverId,
        checkInId,
        ipAddress: this.firstForwardedIp(forwardedFor),
        userAgent,
      }),
    );

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
    const receiver = await this.mapReceiverValidationFailure(() =>
      this.receiversService.tryCheckInLaterForSender({
        userId: sender.id,
        receiverId,
        checkInId,
        ipAddress: this.firstForwardedIp(forwardedFor),
        userAgent,
      }),
    );

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

    const receiver = await this.mapReceiverValidationFailure(() =>
      this.receiversService.createForSender({
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
      }),
    );
    const requested = await this.receiverConsentService.requestConsent({
      receiver,
      actorUserId: sender.id,
      // The sender's own name is not stored yet (later CB-010 slice); the email must never reach a receiver.
      senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME,
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });
    // A provider failure leaves the receiver PENDING with no request recorded; the row exists, so the sender
    // is told and can use the resend route rather than seeing a 500 for a receiver that was created (CB-009).
    const consentRequestStatus: ConsentRequestStatus = requested?.consentRequestedAt ? 'requested' : 'failed';

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
        consentRequestStatus,
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
      throw new BadRequestException(message);
    }

    return value;
  }

  private optionalText(value: string | undefined): string | undefined {
    return typeof value === 'string' ? value.trim() || undefined : undefined;
  }

  /**
   * Turns the receivers services' typed failures into HTTP errors the app can act on: validation as 400, a
   * `ReceiverRequestError` as its own 409 or 429 with `{ code, message, ...details }`.
   */
  private async mapReceiverValidationFailure<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ReceiverScheduleValidationError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      if (error instanceof ReceiverRequestError) {
        const body = { code: error.code, message: error.message, ...error.details };
        throw error.httpStatus === 409 ? new ConflictException(body) : new HttpException(body, error.httpStatus);
      }
      if (error instanceof Error && RECEIVER_VALIDATION_MESSAGES.has(error.message)) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }
}
