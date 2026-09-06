import { MissingMessageVariableError, PLACEHOLDER_PATTERN, SECTION_PATTERN } from './message-catalog.service';

/**
 * How the catalog's named variables become the numbered `{{n}}` placeholders of a Twilio WhatsApp Content Template
 * (CB-020). Meta approves WhatsApp templates whose positional placeholders are numbered in order of appearance,
 * and a template has no optional sections, so every catalog template maps onto one or more *variants*:
 *
 *   - the plain variant drops every `{{#name}}…{{/name}}` section;
 *   - a variant named `templateKey+name[+name…]` keeps exactly those sections, in the template's own section order;
 *   - in each variant's text the named placeholders become `{{1}}`, `{{2}}`, … by first appearance, so the same
 *     variable used twice keeps one number.
 *
 * The Content SID map (`TWILIO_WHATSAPP_CONTENT_SIDS`) is keyed by variant and language: `checkin_daily:ar` and
 * `checkin_daily+personalNote:ar`. At send time the most specific variant whose optional variables are all present
 * wins; an optional value with no variant to carry it is dropped rather than sent as an empty placeholder.
 * docs/providers/whatsapp.md lists the resulting text and numbering for every seeded row.
 */

/** Names of the optional sections of a catalog template, in order of first appearance. */
export function optionalSectionsOf(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(SECTION_PATTERN)) {
    const name = match[1] ?? '';
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export interface WhatsappTemplateText {
  /** The text to submit as the Content Template, with `{{1}}`, `{{2}}`, … in place of the named placeholders. */
  text: string;
  /** The variable behind `{{n}}` sits at index `n - 1`. */
  placeholders: string[];
}

/** The text of one variant: sections in `keep` stay (markers removed), every other section goes, then numbering. */
export function whatsappTemplateText(template: string, keep: readonly string[]): WhatsappTemplateText {
  const withSections = template.replace(SECTION_PATTERN, (_match, name: string, inner: string) =>
    keep.includes(name) ? inner : '',
  );
  const placeholders: string[] = [];
  const text = withSections.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    let index = placeholders.indexOf(name);
    if (index < 0) {
      placeholders.push(name);
      index = placeholders.length - 1;
    }
    return `{{${index + 1}}}`;
  });

  return { text, placeholders };
}

/** `checkin_daily+personalNote` for `['personalNote']`, `checkin_daily` for no sections. */
export function whatsappVariantKey(templateKey: string, keep: readonly string[]): string {
  return keep.length === 0 ? templateKey : `${templateKey}+${keep.join('+')}`;
}

/**
 * Every variant the send could use, most specific first: the subsets of `sections` limited to the variables in
 * `present`, larger subsets before smaller ones, earlier sections before later ones, the plain variant last.
 */
export function whatsappVariantCandidates(sections: readonly string[], present: ReadonlySet<string>): string[][] {
  const available = sections.filter((section) => present.has(section));
  const subsets: string[][] = [[]];
  for (const section of available) {
    subsets.push(...subsets.map((subset) => [...subset, section]));
  }

  const position = (name: string) => sections.indexOf(name);
  return subsets.sort((a, b) => {
    if (a.length !== b.length) {
      return b.length - a.length;
    }
    for (let index = 0; index < a.length; index += 1) {
      const difference = position(a[index] ?? '') - position(b[index] ?? '');
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  });
}

/**
 * The `ContentVariables` for a variant: `{ "1": …, "2": … }` in placeholder order. A missing or blank value throws
 * `MissingMessageVariableError`, exactly like an SMS render, so a template never goes out with Twilio's sample
 * text in a slot. Whitespace runs (newlines included, which approved WhatsApp templates reject) become one space.
 */
export function whatsappContentVariables(
  templateKey: string,
  placeholders: readonly string[],
  variables: Record<string, string | undefined>,
): Record<string, string> {
  const content: Record<string, string> = {};
  placeholders.forEach((name, index) => {
    const value = variables[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new MissingMessageVariableError(templateKey, name);
    }
    content[String(index + 1)] = value.replace(/\s+/g, ' ').trim();
  });

  return content;
}
