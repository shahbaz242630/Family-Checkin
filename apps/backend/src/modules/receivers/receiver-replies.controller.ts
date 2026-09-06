import { Body, Controller, Headers, Inject, Ip, Post } from '@nestjs/common';
import type { Channel, ConsentStatus } from '@prisma/client';
import { assertBearerSecret } from '../../shared/auth/bearer-secret';
import { AppConfigService } from '../../shared/config/app-config.service';
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

/**
 * Provider-free inbound replies for local testing. Only registered in fake mode (see `ReceiverRepliesModule`),
 * and even then a caller must present the operations cron secret: this route runs the real reply pipeline,
 * so an open version would let anyone close a check-in or revoke a receiver's consent.
 */
@Controller('receiver-replies')
export class ReceiverRepliesController {
  constructor(
    @Inject(ReceiverReplyService) private readonly receiverReplyService: ReceiverReplyService,
    @Inject(AppConfigService) private readonly config: Pick<AppConfigService, 'operationsCronSecret'>,
  ) {}

  @Post('fake')
  async handleFakeInboundReply(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: FakeInboundReceiverReplyBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<FakeInboundReceiverReplyResponse> {
    assertBearerSecret(authorization, this.config.operationsCronSecret, 'Operations cron bearer token is required');

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
}
