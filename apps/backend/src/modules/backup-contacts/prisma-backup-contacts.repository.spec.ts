import { describe, expect, it, vi } from 'vitest';
import { PrismaBackupContactsRepository } from './prisma-backup-contacts.repository';

describe('PrismaBackupContactsRepository', () => {
  it('finds an active backup contact by phone hash without selecting receiver PII', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'contact-1',
      receiverId: 'receiver-1',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      relationshipToReceiver: 'Cousin',
      locationInstructionsEncrypted: null,
      priorityOrder: 0,
      deletedAt: null,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    });
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: vi.fn() },
      backupContact: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        findFirst,
        updateMany: vi.fn(),
      },
    });

    const contact = await repository.findActiveByPhoneHash('phone-hash');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        phoneHash: 'phone-hash',
        deletedAt: null,
        receiver: { deletedAt: null },
      },
    });
    expect(contact).toEqual({
      id: 'contact-1',
      receiverId: 'receiver-1',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      relationshipToReceiver: 'Cousin',
      locationInstructionsEncrypted: undefined,
      priorityOrder: 0,
      deletedAt: undefined,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    });
    expect(JSON.stringify(findFirst.mock.calls)).not.toContain('receiver.name');
    expect(JSON.stringify(findFirst.mock.calls)).not.toContain('receiver.phone');
  });

  it('lists active backup contacts scoped to receiver ownership', async () => {
    const receiverFindFirst = vi.fn().mockResolvedValue({ id: 'receiver-1' });
    const backupContactFindMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: receiverFindFirst },
      backupContact: {
        findMany: backupContactFindMany,
        count: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    await repository.findManyForReceiverForUser({
      userId: 'user-1',
      receiverId: 'receiver-1',
    });

    expect(receiverFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'receiver-1',
        userId: 'user-1',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(backupContactFindMany).toHaveBeenCalledWith({
      where: {
        receiverId: 'receiver-1',
        deletedAt: null,
      },
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('returns null instead of listing contacts for unowned receivers', async () => {
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: vi.fn().mockResolvedValue(null) },
      backupContact: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    await expect(repository.findManyForReceiverForUser({ userId: 'user-1', receiverId: 'receiver-1' })).resolves.toBeNull();
  });

  it('counts active backup contacts scoped to receiver ownership', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: vi.fn().mockResolvedValue({ id: 'receiver-1' }) },
      backupContact: {
        findMany: vi.fn(),
        count,
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    await repository.countActiveForReceiverForUser({ userId: 'user-1', receiverId: 'receiver-1' });

    expect(count).toHaveBeenCalledWith({
      where: {
        receiverId: 'receiver-1',
        deletedAt: null,
      },
    });
  });

  it('creates backup contacts only for owned active receivers', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'contact-1',
      receiverId: 'receiver-1',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      relationshipToReceiver: 'Cousin',
      locationInstructionsEncrypted: 'encrypted-location',
      priorityOrder: 0,
      deletedAt: null,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    });
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: vi.fn().mockResolvedValue({ id: 'receiver-1' }) },
      backupContact: {
        findMany: vi.fn(),
        count: vi.fn(),
        create,
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    await repository.createForReceiverForUser({
      userId: 'user-1',
      receiverId: 'receiver-1',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      relationshipToReceiver: 'Cousin',
      locationInstructionsEncrypted: 'encrypted-location',
      priorityOrder: 0,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        receiverId: 'receiver-1',
        nameEncrypted: 'encrypted-name',
        phoneEncrypted: 'encrypted-phone',
        phoneHash: 'phone-hash',
        relationshipToReceiver: 'Cousin',
        locationInstructionsEncrypted: 'encrypted-location',
        priorityOrder: 0,
      },
    });
  });

  it('updates backup contacts only when the sender owns the receiver and contact is active', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      id: 'contact-1',
      receiverId: 'receiver-1',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      relationshipToReceiver: 'Brother',
      locationInstructionsEncrypted: null,
      priorityOrder: 0,
      deletedAt: null,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    });
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: vi.fn().mockResolvedValue({ id: 'receiver-1' }) },
      backupContact: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        findFirst,
        updateMany,
      },
    });

    await repository.updateForReceiverForUser({
      userId: 'user-1',
      receiverId: 'receiver-1',
      backupContactId: 'contact-1',
      nameEncrypted: 'encrypted-name',
      relationshipToReceiver: 'Brother',
      locationInstructionsEncrypted: null,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contact-1',
        receiverId: 'receiver-1',
        deletedAt: null,
      },
      data: {
        nameEncrypted: 'encrypted-name',
        relationshipToReceiver: 'Brother',
        locationInstructionsEncrypted: null,
      },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'contact-1',
        receiverId: 'receiver-1',
      },
    });
  });

  it('soft deletes backup contacts only when the sender owns the receiver and contact is active', async () => {
    const deletedAt = new Date('2026-04-28T12:00:00.000Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      id: 'contact-1',
      receiverId: 'receiver-1',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      relationshipToReceiver: 'Cousin',
      locationInstructionsEncrypted: null,
      priorityOrder: 0,
      deletedAt: null,
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    });
    const repository = new PrismaBackupContactsRepository({
      receiver: { findFirst: vi.fn().mockResolvedValue({ id: 'receiver-1' }) },
      backupContact: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        findFirst,
        updateMany,
      },
    });

    await repository.deleteForReceiverForUser({
      userId: 'user-1',
      receiverId: 'receiver-1',
      backupContactId: 'contact-1',
      deletedAt,
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'contact-1',
        receiverId: 'receiver-1',
        deletedAt: null,
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contact-1',
        receiverId: 'receiver-1',
        deletedAt: null,
      },
      data: {
        deletedAt,
      },
    });
  });
});
