import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import type { ChannelTemplateRepository } from './channel-template.repository';
import { CHANNEL_TEMPLATE_REPOSITORY } from './channels.tokens';
import {
  DEFAULT_MESSAGE_LANGUAGE,
  IN_CODE_MESSAGE_TEMPLATES,
  localizeNeutralSenderDisplayName,
} from './message-catalog.templates';

export interface RenderMessageInput {
  templateKey: string;
  language: string;
  variables: Record<string, string | undefined>;
  /** Needed to consult `channel_templates`; without it only the in-code copy is used. */
  channel?: Channel;
}

export interface RenderedMessage {
  body: string;
  /** Language of the copy that was actually rendered (`en` whenever `fallback` is true). */
  language: string;
  /** True when no copy exists for the requested language and the English text went out instead. */
  fallback: boolean;
}

/** What a provider reports back about the copy it sent, for audit and attempt metadata. */
export interface MessageRendering {
  language: string;
  fallback: boolean;
}

export class MessageCatalogError extends Error {}

export class UnknownMessageTemplateError extends MessageCatalogError {
  constructor(public readonly templateKey: string) {
    super(`Unknown message template: ${templateKey}`);
  }
}

export class MissingMessageVariableError extends MessageCatalogError {
  constructor(
    public readonly templateKey: string,
    public readonly variable: string,
  ) {
    super(`Message template ${templateKey} requires variable "${variable}"`);
  }
}

export class MalformedMessageTemplateError extends MessageCatalogError {
  constructor(
    public readonly templateKey: string,
    public readonly language: string,
  ) {
    super(`Message template ${templateKey} (${language}) contains an unresolved placeholder`);
  }
}

/** `{{#name}}…{{/name}}`: an optional section, kept only when `name` is present. Shared with the WhatsApp mapping. */
export const SECTION_PATTERN = /\{\{#([A-Za-z][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
/** `{{name}}`: a required placeholder. */
export const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Turns a template key plus variables into the text a receiver, backup contact or sender actually reads.
 *
 * Resolution order for (key, language):
 *   1. an active `channel_templates` row for the requested language (and its base language, `en-GB` -> `en`)
 *   2. in-code copy for that language
 *   3. English, database row first then in-code, reported with `fallback: true`
 *   4. `UnknownMessageTemplateError`
 *
 * Rendering fails closed: a required variable that is missing or blank throws, and a body can never leave with
 * `{{...}}` still in it. Variable values are inserted verbatim and never re-scanned, so a name containing braces
 * cannot inject a placeholder.
 */
@Injectable()
export class MessageCatalogService {
  constructor(
    @Optional()
    @Inject(CHANNEL_TEMPLATE_REPOSITORY)
    private readonly templates?: ChannelTemplateRepository,
  ) {}

  async render(input: RenderMessageInput): Promise<RenderedMessage> {
    const requestedLanguages = languageCandidates(input.language);

    for (const language of requestedLanguages) {
      const body = await this.findBody(input.templateKey, language, input.channel);
      if (body !== null) {
        return { body: renderIn(input, language, body), language, fallback: false };
      }
    }

    const fallbackBody = await this.findBody(input.templateKey, DEFAULT_MESSAGE_LANGUAGE, input.channel);
    if (fallbackBody === null) {
      throw new UnknownMessageTemplateError(input.templateKey);
    }

    return {
      body: renderIn(input, DEFAULT_MESSAGE_LANGUAGE, fallbackBody),
      language: DEFAULT_MESSAGE_LANGUAGE,
      fallback: !requestedLanguages.includes(DEFAULT_MESSAGE_LANGUAGE),
    };
  }

  /**
   * The template text for exactly this language and channel, with its `{{name}}` placeholders and optional
   * sections intact: the active `channel_templates` row, else the in-code copy, else `null`. No language fallback
   * here; the WhatsApp provider walks the candidates itself to number the placeholders of the template that is
   * actually approved (CB-020).
   */
  async templateBody(input: { templateKey: string; language: string; channel?: Channel }): Promise<string | null> {
    return this.findBody(input.templateKey, input.language.trim().toLowerCase(), input.channel);
  }

  private async findBody(templateKey: string, language: string, channel: Channel | undefined): Promise<string | null> {
    if (this.templates && channel) {
      const row = await this.templates.findActive({ templateKey, language, channel });
      if (row) {
        return row.bodyText;
      }
    }

    return inCodeBody(templateKey, language);
  }
}

/** Audit/attempt metadata for a provider result; empty when the provider did not render (WhatsApp content SIDs). */
export function renderingAuditMetadata(
  rendering: MessageRendering | undefined,
): { renderedLanguage: string; renderFallback: boolean } | Record<never, never> {
  return rendering ? { renderedLanguage: rendering.language, renderFallback: rendering.fallback } : {};
}

function inCodeBody(templateKey: string, language: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(IN_CODE_MESSAGE_TEMPLATES, templateKey)) {
    return null;
  }

  const byLanguage = IN_CODE_MESSAGE_TEMPLATES[templateKey as keyof typeof IN_CODE_MESSAGE_TEMPLATES];
  return byLanguage[language] ?? null;
}

/**
 * Renders `template` in the language the catalog settled on. The neutral sender wording follows that language
 * (CB-079): a caller can only pass the English constants, and the copy they land in may be Arabic.
 */
function renderIn(input: RenderMessageInput, language: string, template: string): string {
  const senderDisplayName = input.variables.senderDisplayName;
  const variables =
    typeof senderDisplayName === 'string'
      ? { ...input.variables, senderDisplayName: localizeNeutralSenderDisplayName(senderDisplayName, language) }
      : input.variables;

  return renderTemplate(input.templateKey, language, template, variables);
}

/** `en-GB` -> ['en-gb', 'en']; `ar` -> ['ar']; blank -> ['en']. */
export function languageCandidates(language: string): string[] {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return [DEFAULT_MESSAGE_LANGUAGE];
  }

  const base = normalized.split(/[-_]/)[0] ?? normalized;
  return base === normalized ? [normalized] : [normalized, base];
}

function renderTemplate(
  templateKey: string,
  language: string,
  template: string,
  variables: Record<string, string | undefined>,
): string {
  const withSections = template.replace(SECTION_PATTERN, (_match, name: string, inner: string) =>
    isPresent(variables[name]) ? inner : '',
  );

  let output = '';
  let cursor = 0;
  for (const match of withSections.matchAll(PLACEHOLDER_PATTERN)) {
    const index = match.index ?? 0;
    output += literal(templateKey, language, withSections.slice(cursor, index));
    const name = match[1] ?? '';
    const value = variables[name];
    if (!isPresent(value)) {
      throw new MissingMessageVariableError(templateKey, name);
    }
    output += value.trim();
    cursor = index + match[0].length;
  }
  output += literal(templateKey, language, withSections.slice(cursor));

  return output;
}

function literal(templateKey: string, language: string, segment: string): string {
  if (segment.includes('{{') || segment.includes('}}')) {
    throw new MalformedMessageTemplateError(templateKey, language);
  }

  return segment;
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
