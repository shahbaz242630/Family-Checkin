import { Injectable } from '@nestjs/common';
import type { AuditLog } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AppendAuditLogInput, AuditLogRecord, AuditRepository } from './audit.repository';

interface AuditPrismaClient {
  auditLog: {
    create(args: { data: AppendAuditLogInput }): Promise<AuditLog>;
  };
}

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: AuditPrismaClient | PrismaService) {}

  async append(input: AppendAuditLogInput): Promise<AuditLogRecord> {
    const auditLog = await this.prisma.auditLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actorType: input.actorType,
        actorId: input.actorId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return {
      id: auditLog.id,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      action: auditLog.action,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId ?? undefined,
      metadata: this.toAuditMetadata(auditLog.metadata),
      ipAddress: auditLog.ipAddress ?? undefined,
      userAgent: auditLog.userAgent ?? undefined,
      createdAt: auditLog.createdAt,
    };
  }

  private toAuditMetadata(metadata: unknown): AuditLogRecord['metadata'] {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    return metadata as AuditLogRecord['metadata'];
  }
}
