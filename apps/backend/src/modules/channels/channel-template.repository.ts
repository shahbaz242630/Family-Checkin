import type { Channel } from '@prisma/client';

export interface FindActiveChannelTemplateInput {
  templateKey: string;
  language: string;
  channel: Channel;
}

export interface ChannelTemplateRecord {
  bodyText: string;
}

/**
 * Read side of the `channel_templates` table: an active row for (key, language, channel) overrides the in-code
 * copy of `MessageCatalogService`. Migration `202609060103_seed_channel_templates_8_languages` seeds every template
 * key for SMS and WhatsApp in en, ar, es, hi, ur, ml, ta and bn (machine translations pending native review, see
 * `docs/handoffs/message-copy-review.md`); a language outside that set still falls back to the in-code English copy.
 */
export interface ChannelTemplateRepository {
  findActive(input: FindActiveChannelTemplateInput): Promise<ChannelTemplateRecord | null>;
}

export interface InMemoryChannelTemplate extends FindActiveChannelTemplateInput {
  bodyText: string;
  active?: boolean;
}

/** Deterministic repository for specs and local runs without a database. */
export class InMemoryChannelTemplateRepository implements ChannelTemplateRepository {
  private readonly templates: InMemoryChannelTemplate[];

  constructor(templates: InMemoryChannelTemplate[] = []) {
    this.templates = [...templates];
  }

  add(template: InMemoryChannelTemplate): void {
    this.templates.push(template);
  }

  async findActive(input: FindActiveChannelTemplateInput): Promise<ChannelTemplateRecord | null> {
    const match = this.templates.find(
      (template) =>
        template.active !== false &&
        template.templateKey === input.templateKey &&
        template.language === input.language &&
        template.channel === input.channel,
    );

    return match ? { bodyText: match.bodyText } : null;
  }
}
