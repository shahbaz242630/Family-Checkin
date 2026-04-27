import { Body, Controller, Headers, Inject, Ip, Post } from '@nestjs/common';
import type { Channel, ConsentStatus } from '@prisma/client';
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
  consentStatus: ConsentStatus;
}

@Controller('receiver-replies')
export class ReceiverRepliesController {
  constructor(@Inject(ReceiverReplyService) private readonly receiverReplyService: ReceiverReplyService) {}

  @Post('fake')
  async handleFakeInboundReply(
    @Body() body: FakeInboundReceiverReplyBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<FakeInboundReceiverReplyResponse> {
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
