import { BadRequestException, Body, Controller, Get, Headers, Inject, Ip, Post, Query } from '@nestjs/common';
import type { Channel, ConsentStatus } from '@prisma/client';
import { assertBearerSecret } from '../../shared/auth/bearer-secret';
import { AppConfigService } from '../../shared/config/app-config.service';
import {
  DEFAULT_FAKE_OUTBOUND_LIST_LIMIT,
  FakeOutboundRecorder,
  type FakeOutboundRecord,
} from '../channels/fake-outbound-recorder';
import { ReceiverReplyService } from './receiver-reply.service';

interface FakeInboundReceiverReplyBody {
  fromPhone: string;
  channel: Channel;
  body: string;
  providerMessageId?: string;
}

interface FakeInboundReceiverReplyResponse {
  ok: true;
  receiverId: string;
  action: string;
  consentStatus?: ConsentStatus;
  checkInId?: string;
  checkInStatus?: string;
  backupContactId?: string;
}

interface FakeOutboundListResponse {
  ok: true;
  count: number;
  /** Newest first. */
  sends: FakeOutboundRecord[];
}

const MAX_FAKE_OUTBOUND_LIST_LIMIT = 200;
const CRON_BEARER_REQUIRED = 'Operations cron bearer token is required';

/**
 * Provider-free local testing routes. Only registered in fake mode (see `ReceiverRepliesModule`), and even
 * then a caller must present the operations cron secret: the POST runs the real reply pipeline, so an open
 * version would let anyone close a check-in or revoke a receiver's consent, and the GET returns the phone
 * numbers and message bodies the fake providers would have transmitted.
 */
@Controller('receiver-replies')
export class ReceiverRepliesController {
  constructor(
    @Inject(ReceiverReplyService) private readonly receiverReplyService: ReceiverReplyService,
    @Inject(AppConfigService) private readonly config: Pick<AppConfigService, 'operationsCronSecret'>,
    @Inject(FakeOutboundRecorder) private readonly fakeOutbound: Pick<FakeOutboundRecorder, 'recent'>,
  ) {}

  @Post('fake')
  async handleFakeInboundReply(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: FakeInboundReceiverReplyBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<FakeInboundReceiverReplyResponse> {
    assertBearerSecret(authorization, this.config.operationsCronSecret, CRON_BEARER_REQUIRED);

    const result = await this.receiverReplyService.handleInboundReply({
      fromPhone: body.fromPhone,
      channel: body.channel,
      body: body.body,
      providerMessageId: body.providerMessageId,
      ipAddress,
      userAgent,
    });

    return {
      ok: true,
      ...result,
    };
  }

  /**
   * What the fake providers "sent", newest first: rendered SMS/WhatsApp bodies (including step-up OTP codes)
   * and voice call scripts. This is how an emulator session reads a consent request, a check-in or an OTP
   * without a real phone (CB-067).
   */
  @Get('fake/outbound')
  listFakeOutbound(
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit?: string,
  ): FakeOutboundListResponse {
    assertBearerSecret(authorization, this.config.operationsCronSecret, CRON_BEARER_REQUIRED);

    const sends = this.fakeOutbound.recent(parseListLimit(limit));

    return { ok: true, count: sends.length, sends };
  }
}

function parseListLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_FAKE_OUTBOUND_LIST_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_FAKE_OUTBOUND_LIST_LIMIT) {
    throw new BadRequestException(`limit must be an integer between 1 and ${MAX_FAKE_OUTBOUND_LIST_LIMIT}`);
  }

  return parsed;
}
