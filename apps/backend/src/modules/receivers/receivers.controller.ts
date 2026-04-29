import { Body, Controller, Delete, Get, Headers, Inject, NotFoundException, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import type { Channel, RelationshipType, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import { ReceiverConsentService } from './receiver-consent.service';
import { ReceiversService } from './receivers.service';

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

    return { receiver };
  }

  @Patch(':receiverId/pause')
  async pause(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const receiver = await this.receiversService.pauseForSender({
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
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Param('receiverId') receiverId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
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

  private required<T>(value: T | undefined, message: string): T {
    if (!value) {
      throw new Error(message);
    }

    return value;
  }
}
