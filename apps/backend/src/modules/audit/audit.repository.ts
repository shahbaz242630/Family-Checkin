import type { ActorType } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export type AuditMetadata = Prisma.InputJsonObject;

export interface AppendAuditLogInput {
  entityType: string;
  entityId: string;
  action: string;
  actorType: ActorType;
  actorId?: string;
  metadata?: AuditMetadata;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogRecord extends AppendAuditLogInput {
  id: string;
  createdAt: Date;
}

export interface AuditRepository {
  append(input: AppendAuditLogInput): Promise<AuditLogRecord>;
}
