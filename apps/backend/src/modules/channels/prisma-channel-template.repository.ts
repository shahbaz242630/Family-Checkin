import { Inject, Injectable } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ChannelTemplateRecord,
  ChannelTemplateRepository,
  FindActiveChannelTemplateInput,
} from './channel-template.repository';

interface ChannelTemplatePrismaClient {
  channelTemplate: {
    findFirst(args: {
      where: { templateKey: string; language: string; channel: Channel; active: true };
      select: { bodyText: true };
    }): Promise<{ bodyText: string } | null>;
  };
}

@Injectable()
export class PrismaChannelTemplateRepository implements ChannelTemplateRepository {
  constructor(@Inject(PrismaService) private readonly prisma: ChannelTemplatePrismaClient | PrismaService) {}

  async findActive(input: FindActiveChannelTemplateInput): Promise<ChannelTemplateRecord | null> {
    const template = (await this.prisma.channelTemplate.findFirst({
      where: {
        templateKey: input.templateKey,
        language: input.language,
        channel: input.channel,
        active: true,
      },
      select: {
        bodyText: true,
      },
    })) as { bodyText: string } | null;

    return template ? { bodyText: template.bodyText } : null;
  }
}
