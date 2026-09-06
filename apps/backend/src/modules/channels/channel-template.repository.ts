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
 * copy of `MessageCatalogService`. Rows are seeded by migration in a later slice of CB-010; until then every lookup
 * misses and the in-code English copy is what goes out.
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
