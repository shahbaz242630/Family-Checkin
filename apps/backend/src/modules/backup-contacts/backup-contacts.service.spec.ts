import { ActorType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type {
  BackupContactRecord,
  BackupContactsRepository,
  CreateBackupContactRecordInput,
  DeleteBackupContactRecordInput,
  UpdateBackupContactRecordInput,
} from './backup-contacts.repository';
import { BackupContactsService } from './backup-contacts.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryBackupContactsRepository implements BackupContactsRepository {
  public contacts: BackupContactRecord[] = [];
  public receiverExists = true;
  public lastCreateInput: CreateBackupContactRecordInput | null = null;
  public lastUpdateInput: UpdateBackupContactRecordInput | null = null;
  public lastDeleteInput: DeleteBackupContactRecordInput | null = null;

  async findManyForReceiverForUser(input: { userId: string; receiverId: string }): Promise<BackupContactRecord[] | null> {
    if (!this.receiverExists) return null;
    return this.contacts.filter((contact) => contact.receiverId === input.receiverId && !contact.deletedAt);
  }

  async countActiveForReceiverForUser(input: { userId: string; receiverId: string }): Promise<number | null> {
    if (!this.receiverExists) return null;
    return this.contacts.filter((contact) => contact.receiverId === input.receiverId && !contact.deletedAt).length;
  }

  async createForReceiverForUser(input: CreateBackupContactRecordInput): Promise<BackupContactRecord | null> {
    if (!this.receiverExists) return null;
    this.lastCreateInput = input;
    const contact = {
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      receiverId: input.receiverId,
      nameEncrypted: input.nameEncrypted,
      phoneEncrypted: input.phoneEncrypted,
      phoneHash: input.phoneHash,
      relationshipToReceiver: input.relationshipToReceiver,
      locationInstructionsEncrypted: input.locationInstructionsEncrypted,
      priorityOrder: input.priorityOrder,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    };
    this.contacts.push(contact);
    return contact;
  }

  async updateForReceiverForUser(input: UpdateBackupContactRecordInput): Promise<BackupContactRecord | null> {
    if (!this.receiverExists) return null;
    this.lastUpdateInput = input;
    const index = this.contacts.findIndex(
      (contact) => contact.id === input.backupContactId && contact.receiverId === input.receiverId && !contact.deletedAt,
    );
    if (index === -1) return null;

    const existing = this.contacts[index] as BackupContactRecord;
    const updated: BackupContactRecord = {
      ...existing,
      nameEncrypted: input.nameEncrypted,
      phoneEncrypted: input.phoneEncrypted ?? existing.phoneEncrypted,
      phoneHash: input.phoneHash ?? existing.phoneHash,
      relationshipToReceiver: input.relationshipToReceiver,
      locationInstructionsEncrypted: input.locationInstructionsEncrypted ?? undefined,
    };
    this.contacts[index] = updated;
    return updated;
  }

  async deleteForReceiverForUser(input: DeleteBackupContactRecordInput): Promise<BackupContactRecord | null> {
    if (!this.receiverExists) return null;
    this.lastDeleteInput = input;
    const index = this.contacts.findIndex(
      (contact) => contact.id === input.backupContactId && contact.receiverId === input.receiverId && !contact.deletedAt,
    );
    if (index === -1) return null;

    const deleted: BackupContactRecord = { ...(this.contacts[index] as BackupContactRecord), deletedAt: input.deletedAt };
    this.contacts[index] = deleted;
    return deleted;
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: 'audit-1',
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
      ...input,
    };
  }
}

describe('BackupContactsService', () => {
  it('creates an encrypted backup contact and audits safe metadata', async () => {
    const repository = new InMemoryBackupContactsRepository();
    const crypto = new CryptoService(masterKey);
    const audit = new InMemoryAuditService();
    const service = new BackupContactsService(repository, crypto, audit as unknown as AuditService);

    const contact = await service.createForReceiver({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      name: '  Fatima Backup  ',
      phone: '050 765 4321',
      phoneCountry: 'AE',
      relationshipToReceiver: '  Cousin  ',
      locationInstructions: 'Building 4, call before visiting',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(contact).toEqual({
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      displayName: 'Fatima Backup',
      phoneMasked: '*******4321',
      relationshipToReceiver: 'Cousin',
      priorityOrder: 0,
      hasLocationInstructions: true,
      createdAt: '2026-04-28T10:00:00.000Z',
    });
    expect(repository.lastCreateInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      phoneHash: crypto.hashForLookup('+971507654321'),
      relationshipToReceiver: 'Cousin',
      priorityOrder: 0,
    });
    expect(crypto.decrypt(repository.lastCreateInput?.nameEncrypted ?? '')).toBe('Fatima Backup');
    expect(crypto.decrypt(repository.lastCreateInput?.phoneEncrypted ?? '')).toBe('+971507654321');
    expect(crypto.decrypt(repository.lastCreateInput?.locationInstructionsEncrypted ?? '')).toBe('Building 4, call before visiting');
    expect(audit.events).toEqual([
      {
        entityType: 'backup_contact',
        entityId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        action: 'backup_contact.created',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          relationshipToReceiver: 'Cousin',
          priorityOrder: 0,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });

  it('lists backup contacts without exposing raw PII', async () => {
    const repository = new InMemoryBackupContactsRepository();
    const crypto = new CryptoService(masterKey);
    repository.contacts = [
      {
        id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        nameEncrypted: crypto.encrypt('Fatima Backup'),
        phoneEncrypted: crypto.encrypt('+971507654321'),
        phoneHash: crypto.hashForLookup('+971507654321'),
        relationshipToReceiver: 'Cousin',
        locationInstructionsEncrypted: crypto.encrypt('Building 4'),
        priorityOrder: 0,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      },
    ];
    const service = new BackupContactsService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);

    const contacts = await service.listForReceiver({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(contacts).toEqual([
      {
        id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        displayName: 'Fatima Backup',
        phoneMasked: '*******4321',
        relationshipToReceiver: 'Cousin',
        priorityOrder: 0,
        hasLocationInstructions: true,
        createdAt: '2026-04-28T10:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(contacts)).not.toContain('+971507654321');
    expect(JSON.stringify(contacts)).not.toContain('phoneHash');
    expect(JSON.stringify(contacts)).not.toContain('Building 4');
  });

  it('returns null when the receiver is missing or not owned by the sender', async () => {
    const repository = new InMemoryBackupContactsRepository();
    repository.receiverExists = false;
    const service = new BackupContactsService(
      repository,
      new CryptoService(masterKey),
      new InMemoryAuditService() as unknown as AuditService,
    );

    await expect(
      service.listForReceiver({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: 'missing-receiver',
      }),
    ).resolves.toBeNull();
    await expect(
      service.createForReceiver({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: 'missing-receiver',
        name: 'Fatima',
        phone: '+971507654321',
        relationshipToReceiver: 'Cousin',
      }),
    ).resolves.toBeNull();
  });

  it('limits each receiver to five active backup contacts', async () => {
    const repository = new InMemoryBackupContactsRepository();
    const crypto = new CryptoService(masterKey);
    repository.contacts = Array.from({ length: 5 }, (_, index) => ({
      id: `contact-${index}`,
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      nameEncrypted: crypto.encrypt(`Backup ${index}`),
      phoneEncrypted: crypto.encrypt(`+97150765432${index}`),
      phoneHash: `hash-${index}`,
      relationshipToReceiver: 'Cousin',
      priorityOrder: index,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    }));
    const service = new BackupContactsService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);

    await expect(
      service.createForReceiver({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        name: 'Too Many',
        phone: '+971507654321',
        relationshipToReceiver: 'Cousin',
      }),
    ).rejects.toThrow('A receiver can have at most 5 active backup contacts');
  });

  it('updates encrypted backup contact fields and audits safe metadata', async () => {
    const repository = new InMemoryBackupContactsRepository();
    const crypto = new CryptoService(masterKey);
    repository.contacts = [
      {
        id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        nameEncrypted: crypto.encrypt('Fatima Backup'),
        phoneEncrypted: crypto.encrypt('+971507654321'),
        phoneHash: crypto.hashForLookup('+971507654321'),
        relationshipToReceiver: 'Cousin',
        priorityOrder: 0,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      },
    ];
    const audit = new InMemoryAuditService();
    const service = new BackupContactsService(repository, crypto, audit as unknown as AuditService);

    const contact = await service.updateForReceiver({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      name: '  Omar Backup  ',
      phone: '050 111 2222',
      phoneCountry: 'AE',
      relationshipToReceiver: '  Brother  ',
      locationInstructions: 'Apartment 14',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(contact).toMatchObject({
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      displayName: 'Omar Backup',
      phoneMasked: '*******2222',
      relationshipToReceiver: 'Brother',
      hasLocationInstructions: true,
    });
    expect(repository.lastUpdateInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      phoneHash: crypto.hashForLookup('+971501112222'),
      relationshipToReceiver: 'Brother',
    });
    expect(crypto.decrypt(repository.lastUpdateInput?.nameEncrypted ?? '')).toBe('Omar Backup');
    expect(crypto.decrypt(repository.lastUpdateInput?.phoneEncrypted ?? '')).toBe('+971501112222');
    expect(crypto.decrypt(repository.lastUpdateInput?.locationInstructionsEncrypted ?? '')).toBe('Apartment 14');
    expect(audit.events).toEqual([
      {
        entityType: 'backup_contact',
        entityId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        action: 'backup_contact.updated',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          relationshipToReceiver: 'Brother',
          priorityOrder: 0,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });

  it('updates a backup contact while preserving the existing phone when no phone is provided', async () => {
    const repository = new InMemoryBackupContactsRepository();
    const crypto = new CryptoService(masterKey);
    repository.contacts = [
      {
        id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        nameEncrypted: crypto.encrypt('Fatima Backup'),
        phoneEncrypted: crypto.encrypt('+971507654321'),
        phoneHash: crypto.hashForLookup('+971507654321'),
        relationshipToReceiver: 'Cousin',
        locationInstructionsEncrypted: crypto.encrypt('Building 4'),
        priorityOrder: 0,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      },
    ];
    const service = new BackupContactsService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);

    const contact = await service.updateForReceiver({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      name: 'Fatima Backup',
      relationshipToReceiver: 'Cousin',
      locationInstructions: '',
    });

    expect(contact?.phoneMasked).toBe('*******4321');
    expect(contact?.hasLocationInstructions).toBe(false);
    expect(repository.lastUpdateInput?.phoneEncrypted).toBeUndefined();
    expect(repository.lastUpdateInput?.phoneHash).toBeUndefined();
    expect(repository.lastUpdateInput?.locationInstructionsEncrypted).toBeNull();
  });

  it('soft deletes a backup contact and audits safe metadata', async () => {
    const repository = new InMemoryBackupContactsRepository();
    const crypto = new CryptoService(masterKey);
    repository.contacts = [
      {
        id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        nameEncrypted: crypto.encrypt('Fatima Backup'),
        phoneEncrypted: crypto.encrypt('+971507654321'),
        phoneHash: crypto.hashForLookup('+971507654321'),
        relationshipToReceiver: 'Cousin',
        priorityOrder: 0,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      },
    ];
    const audit = new InMemoryAuditService();
    const service = new BackupContactsService(repository, crypto, audit as unknown as AuditService);

    const deleted = await service.deleteForReceiver({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(deleted?.id).toBe('9f5d197a-c358-48f1-9a79-e4c9686b9dd4');
    expect(repository.lastDeleteInput?.deletedAt).toBeInstanceOf(Date);
    expect(await repository.countActiveForReceiverForUser({ userId: 'user-1', receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb' })).toBe(0);
    expect(audit.events).toMatchObject([
      {
        entityType: 'backup_contact',
        entityId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        action: 'backup_contact.deleted',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          priorityOrder: 0,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });
});
