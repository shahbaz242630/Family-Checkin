import { ActorType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AuditService } from './audit.service';
import type { AppendAuditLogInput, AuditLogRecord, AuditRepository } from './audit.repository';

class InMemoryAuditRepository implements AuditRepository {
  public records: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput): Promise<AuditLogRecord> {
    this.records.push(input);
    return {
      id: '04dc851f-5cb1-4d3c-9d6b-1b015b9af62f',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }
}

describe('AuditService', () => {
  it('appends a non-sensitive audit event', async () => {
    const repository = new InMemoryAuditRepository();
    const service = new AuditService(repository);

    const auditLog = await service.append({
      entityType: 'receiver',
      entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
      action: 'receiver.created',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {
        consentStatus: 'PENDING',
        primaryChannel: 'WHATSAPP',
        fallbackChannels: ['SMS', 'VOICE'],
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(auditLog).toMatchObject({
      id: '04dc851f-5cb1-4d3c-9d6b-1b015b9af62f',
      entityType: 'receiver',
      action: 'receiver.created',
      actorType: ActorType.USER,
    });
    expect(repository.records).toHaveLength(1);
  });

  it('rejects metadata keys and values that contain raw PII', async () => {
    const service = new AuditService(new InMemoryAuditRepository());
    const baseInput = {
      entityType: 'receiver',
      entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
      action: 'receiver.created',
      actorType: ActorType.USER,
    };

    await expect(
      service.append({
        ...baseInput,
        metadata: { receiverPhone: '+971501234567' },
      }),
    ).rejects.toThrow('Audit metadata must not contain raw PII');

    await expect(
      service.append({
        ...baseInput,
        metadata: { channelResult: { email: 'receiver@example.com' } },
      }),
    ).rejects.toThrow('Audit metadata must not contain raw PII');
  });

  it('accepts identifier keys whose name merely mentions a sensitive word', async () => {
    const repository = new InMemoryAuditRepository();
    const service = new AuditService(repository);

    await service.append({
      entityType: 'escalation_event',
      entityId: 'escalation-event-1',
      action: 'escalation.backup_contact_alerted',
      actorType: ActorType.SYSTEM,
      metadata: {
        backupContactId: 'backup-contact-1',
        receiverIds: ['receiver-1', 'receiver-2'],
        contactRef: 'contact-ref-1',
      },
    });

    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.metadata).toEqual({
      backupContactId: 'backup-contact-1',
      receiverIds: ['receiver-1', 'receiver-2'],
      contactRef: 'contact-ref-1',
    });
  });

  it('still rejects sensitive keys and PII-shaped values behind an identifier key', async () => {
    const service = new AuditService(new InMemoryAuditRepository());
    const baseInput = {
      entityType: 'escalation_event',
      entityId: 'escalation-event-1',
      action: 'escalation.backup_contact_alerted',
      actorType: ActorType.SYSTEM,
    };

    await expect(service.append({ ...baseInput, metadata: { contactPhone: 'hashed-anyway' } })).rejects.toThrow(
      'Audit metadata must not contain raw PII',
    );

    await expect(service.append({ ...baseInput, metadata: { contactName: 'hashed-anyway' } })).rejects.toThrow(
      'Audit metadata must not contain raw PII',
    );

    // The identifier suffix is case-sensitive: `phoneid` is not an identifier key.
    await expect(service.append({ ...baseInput, metadata: { phoneid: 'hashed-anyway' } })).rejects.toThrow(
      'Audit metadata must not contain raw PII',
    );

    // An E.164 number is still PII no matter which key it hides behind.
    await expect(service.append({ ...baseInput, metadata: { backupContactId: '+971501234567' } })).rejects.toThrow(
      'Audit metadata must not contain raw PII',
    );
  });

  it('requires core audit fields', async () => {
    const service = new AuditService(new InMemoryAuditRepository());

    await expect(
      service.append({
        entityType: '',
        entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
        action: 'receiver.created',
        actorType: ActorType.USER,
      }),
    ).rejects.toThrow('Audit entity type is required');

    await expect(
      service.append({
        entityType: 'receiver',
        entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
        action: '',
        actorType: ActorType.USER,
      }),
    ).rejects.toThrow('Audit action is required');
  });
});
