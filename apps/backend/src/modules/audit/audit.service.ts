import { Inject, Injectable } from '@nestjs/common';
import type { AppendAuditLogInput, AuditLogRecord, AuditMetadata, AuditRepository } from './audit.repository';
import { AUDIT_REPOSITORY } from './audit.tokens';

const sensitiveKeyPattern = /(email|phone|name|address|note|transcript|location|contact)/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s().-]{7,}[0-9]$/;

@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly auditRepository: AuditRepository) {}

  async append(input: AppendAuditLogInput): Promise<AuditLogRecord> {
    const normalized = this.normalizeInput(input);
    this.assertMetadataIsSafe(normalized.metadata);

    return this.auditRepository.append(normalized);
  }

  private normalizeInput(input: AppendAuditLogInput): AppendAuditLogInput {
    const entityType = input.entityType.trim();
    const entityId = input.entityId.trim();
    const action = input.action.trim();

    if (!entityType) {
      throw new Error('Audit entity type is required');
    }
    if (!entityId) {
      throw new Error('Audit entity id is required');
    }
    if (!action) {
      throw new Error('Audit action is required');
    }

    return {
      ...input,
      entityType,
      entityId,
      action,
    };
  }

  private assertMetadataIsSafe(metadata: AuditMetadata | undefined): void {
    if (!metadata) {
      return;
    }

    this.walkMetadata(metadata, []);
  }

  private walkMetadata(value: unknown, path: string[]): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.walkMetadata(item, [...path, String(index)]));
      return;
    }

    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, nestedValue]) => {
        if (sensitiveKeyPattern.test(key)) {
          throw new Error('Audit metadata must not contain raw PII');
        }
        this.walkMetadata(nestedValue, [...path, key]);
      });
      return;
    }

    if (typeof value === 'string' && this.looksLikeRawPii(value)) {
      throw new Error('Audit metadata must not contain raw PII');
    }
  }

  private looksLikeRawPii(value: string): boolean {
    const trimmed = value.trim();
    return emailPattern.test(trimmed) || phonePattern.test(trimmed);
  }
}
