import { Channel } from '@prisma/client';
import type {
  ChannelCallResult,
  ChannelProvider,
  ChannelSendResult,
  TemplatedMessage,
  VoiceScript,
} from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';
import { languageCandidates, MessageCatalogService } from './message-catalog.service';
import { DEFAULT_MESSAGE_LANGUAGE, localizeNeutralSenderDisplayName } from './message-catalog.templates';
import { FetchTwilioHttpClient, type TwilioHttpClient } from './twilio-http-client';
import { twilioMessagingStatusCallbackUrl } from './twilio-status-callback';
import {
  optionalSectionsOf,
  whatsappContentVariables,
  whatsappTemplateText,
  whatsappVariantCandidates,
  whatsappVariantKey,
} from './whatsapp-content-variables';

export interface WhatsappProviderConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  /**
   * Approved Content SIDs keyed `templateKey[+optional…]:language`, or a language-less `templateKey[+optional…]`
   * used as the English default (`TWILIO_WHATSAPP_CONTENT_SIDS`, docs/providers/whatsapp.md).
   */
  contentSidByTemplateKey?: Record<string, string>;
  /** `PUBLIC_API_BASE_URL`; when set, Twilio posts delivery statuses back to the messaging status route (CB-016). */
  publicApiBaseUrl?: string;
}

type RequiredWhatsappProviderConfig = Required<
  Pick<WhatsappProviderConfig, 'accountSid' | 'authToken' | 'fromNumber' | 'contentSidByTemplateKey'>
>;

interface ResolvedWhatsappContent {
  contentSid: string;
  contentVariables: Record<string, string>;
  /** Language of the approved template that will be sent. */
  language: string;
  /** True when no template exists for the receiver's language and the English one goes out instead. */
  fallback: boolean;
}

export class WhatsappProvider implements ChannelProvider {
  public readonly channel = Channel.WHATSAPP;

  constructor(
    private readonly config: WhatsappProviderConfig,
    private readonly httpClient: TwilioHttpClient = new FetchTwilioHttpClient(),
    private readonly now: () => Date = () => new Date(),
    private readonly catalog: MessageCatalogService = new MessageCatalogService(),
  ) {}

  async sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    const config = this.configured();
    const content = await this.resolveContent(message, config.contentSidByTemplateKey);
    const statusCallback = twilioMessagingStatusCallbackUrl(this.config.publicApiBaseUrl);

    const response = await this.httpClient.postForm(
      this.messagesUrl(config.accountSid),
      new URLSearchParams({
        To: this.whatsappAddress(to),
        From: this.whatsappAddress(config.fromNumber),
        ContentSid: content.contentSid,
        ContentVariables: JSON.stringify(content.contentVariables),
        ...(statusCallback ? { StatusCallback: statusCallback } : {}),
      }),
      config.authToken,
    );

    return {
      providerMessageId: stringFrom(response.sid, 'unknown-twilio-whatsapp-message'),
      acceptedAt: this.now(),
      providerStatus: toMessageStatus(response.status),
      rendering: { language: content.language, fallback: content.fallback },
    };
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<ChannelCallResult> {
    throw new Error('WhatsApp provider cannot make voice calls');
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    this.assertConfigured();
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }

  /**
   * Which approved template carries this message (CB-020): the receiver's language first (`ar-EG`, then `ar`),
   * then English, with the language-less key as the English default; within a language the most specific variant
   * whose optional variables are all present (`checkin_daily+personalNote:ar` before `checkin_daily:ar`). The
   * chosen variant's text — the same text docs/providers/whatsapp.md tells the founder to submit — fixes the
   * `{{n}}` numbering, and the neutral sender wording follows the template's language (CB-079). Nothing is sent
   * when a required variable is blank or no template is configured.
   */
  private async resolveContent(
    message: TemplatedMessage,
    contentSids: Record<string, string>,
  ): Promise<ResolvedWhatsappContent> {
    const requested = languageCandidates(message.language);
    const languages = requested.includes(DEFAULT_MESSAGE_LANGUAGE)
      ? requested
      : [...requested, DEFAULT_MESSAGE_LANGUAGE];
    const present = new Set(
      Object.entries(message.variables)
        .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
        .map(([name]) => name),
    );

    for (const language of languages) {
      const template = await this.catalog.templateBody({
        templateKey: message.templateKey,
        language,
        channel: this.channel,
      });
      if (template === null) {
        if (hasContentSidForLanguage(contentSids, message.templateKey, language)) {
          throw new Error(
            `WhatsApp content template ${message.templateKey}:${language} has a Content SID but no active ` +
              'channel_templates row (WHATSAPP) to number its placeholders from',
          );
        }
        continue;
      }

      for (const keep of whatsappVariantCandidates(optionalSectionsOf(template), present)) {
        const variant = whatsappVariantKey(message.templateKey, keep);
        const contentSid =
          contentSids[`${variant}:${language}`] ??
          (language === DEFAULT_MESSAGE_LANGUAGE ? contentSids[variant] : undefined);
        if (!contentSid) {
          continue;
        }

        const { placeholders } = whatsappTemplateText(template, keep);
        const variables: Record<string, string> = { ...message.variables };
        if (typeof variables.senderDisplayName === 'string') {
          variables.senderDisplayName = localizeNeutralSenderDisplayName(variables.senderDisplayName, language);
        }

        return {
          contentSid,
          contentVariables: whatsappContentVariables(message.templateKey, placeholders, variables),
          language,
          fallback: !requested.includes(language),
        };
      }
    }

    throw new Error(`WhatsApp content template is not configured for ${message.templateKey}:${requested[0]}`);
  }

  private assertConfigured(): void {
    if (
      !this.config.accountSid ||
      !this.config.authToken ||
      !this.config.fromNumber ||
      !this.config.contentSidByTemplateKey
    ) {
      throw new ChannelProviderConfigurationError('WhatsApp');
    }
  }

  private configured(): RequiredWhatsappProviderConfig {
    this.assertConfigured();
    return this.config as RequiredWhatsappProviderConfig;
  }

  private messagesUrl(accountSid: string): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  }

  private whatsappAddress(phone: string): string {
    return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  }
}

/** True when any variant of `templateKey` has a SID for `language` (`templateKey:ar`, `templateKey+personalNote:ar`). */
function hasContentSidForLanguage(contentSids: Record<string, string>, templateKey: string, language: string): boolean {
  return Object.keys(contentSids).some((key) => {
    const separator = key.lastIndexOf(':');
    if (separator < 0) {
      return false;
    }
    const variant = key.slice(0, separator);
    return key.slice(separator + 1) === language && (variant === templateKey || variant.startsWith(`${templateKey}+`));
  });
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function toMessageStatus(value: unknown): ChannelSendResult['providerStatus'] {
  if (value === 'sent') {
    return 'sent';
  }
  if (value === 'queued') {
    return 'queued';
  }
  return 'accepted';
}
