import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BackupContactsController } from './backup-contacts.controller';

class FakeSupabaseAuthService {
  async verifyAccessToken(accessToken: string) {
    return {
      id: `auth-${accessToken}`,
      email: 'sender@example.com',
      phone: '+971500000000',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    };
  }
}

class FakeUsersService {
  async upsertFromSupabaseIdentity() {
    return {
      id: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    };
  }
}

class FakeBackupContactsService {
  public listInput: Record<string, unknown> | null = null;
  public createInput: Record<string, unknown> | null = null;
  public updateInput: Record<string, unknown> | null = null;
  public deleteInput: Record<string, unknown> | null = null;
  public missing = false;

  async listForReceiver(input: Record<string, unknown>) {
    this.listInput = input;
    if (this.missing) return null;
    return [
      {
        id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
        displayName: 'Fatima Backup',
        phoneMasked: '*******4321',
        relationshipToReceiver: 'Cousin',
        priorityOrder: 0,
        hasLocationInstructions: true,
        createdAt: '2026-04-28T10:00:00.000Z',
      },
    ];
  }

  async createForReceiver(input: Record<string, unknown>) {
    this.createInput = input;
    if (this.missing) return null;
    return {
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      displayName: input.name,
      phoneMasked: '*******4321',
      relationshipToReceiver: input.relationshipToReceiver,
      priorityOrder: 0,
      hasLocationInstructions: Boolean(input.locationInstructions),
      createdAt: '2026-04-28T10:00:00.000Z',
    };
  }

  async updateForReceiver(input: Record<string, unknown>) {
    this.updateInput = input;
    if (this.missing) return null;
    return {
      id: input.backupContactId,
      displayName: input.name,
      phoneMasked: '*******2222',
      relationshipToReceiver: input.relationshipToReceiver,
      priorityOrder: 0,
      hasLocationInstructions: Boolean(input.locationInstructions),
      createdAt: '2026-04-28T10:00:00.000Z',
    };
  }

  async deleteForReceiver(input: Record<string, unknown>) {
    this.deleteInput = input;
    if (this.missing) return null;
    return {
      id: input.backupContactId,
      displayName: 'Fatima Backup',
      phoneMasked: '*******4321',
      relationshipToReceiver: 'Cousin',
      priorityOrder: 0,
      hasLocationInstructions: false,
      createdAt: '2026-04-28T10:00:00.000Z',
    };
  }
}

describe('BackupContactsController', () => {
  it('lists backup contacts for an authenticated sender receiver', async () => {
    const backupContactsService = new FakeBackupContactsService();
    const controller = new BackupContactsController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      backupContactsService as never,
    );

    const response = await controller.list('Bearer access-token', '1aef91f9-64c9-4548-baa5-d70b52386efb');

    expect(backupContactsService.listInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });
    expect(response.backupContacts).toHaveLength(1);
  });

  it('creates a backup contact for an authenticated sender receiver', async () => {
    const backupContactsService = new FakeBackupContactsService();
    const controller = new BackupContactsController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      backupContactsService as never,
    );

    const response = await controller.create(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      {
        name: 'Fatima Backup',
        phone: '0507654321',
        phoneCountry: 'AE',
        relationshipToReceiver: 'Cousin',
        locationInstructions: 'Building 4',
      },
    );

    expect(backupContactsService.createInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      name: 'Fatima Backup',
      phone: '0507654321',
      phoneCountry: 'AE',
      relationshipToReceiver: 'Cousin',
      locationInstructions: 'Building 4',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.backupContact).toMatchObject({
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      displayName: 'Fatima Backup',
    });
  });

  it('updates a backup contact for an authenticated sender receiver', async () => {
    const backupContactsService = new FakeBackupContactsService();
    const controller = new BackupContactsController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      backupContactsService as never,
    );

    const response = await controller.update(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      {
        name: 'Omar Backup',
        phone: '0501112222',
        phoneCountry: 'AE',
        relationshipToReceiver: 'Brother',
        locationInstructions: 'Apartment 14',
      },
    );

    expect(backupContactsService.updateInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      name: 'Omar Backup',
      phone: '0501112222',
      phoneCountry: 'AE',
      relationshipToReceiver: 'Brother',
      locationInstructions: 'Apartment 14',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.backupContact).toMatchObject({
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      displayName: 'Omar Backup',
    });
  });

  it('deletes a backup contact for an authenticated sender receiver', async () => {
    const backupContactsService = new FakeBackupContactsService();
    const controller = new BackupContactsController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      backupContactsService as never,
    );

    const response = await controller.delete(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
    );

    expect(backupContactsService.deleteInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.backupContact).toMatchObject({
      id: '9f5d197a-c358-48f1-9a79-e4c9686b9dd4',
    });
  });

  it('returns 404 when receiver is missing or not owned by sender', async () => {
    const backupContactsService = new FakeBackupContactsService();
    backupContactsService.missing = true;
    const controller = new BackupContactsController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      backupContactsService as never,
    );

    await expect(controller.list('Bearer access-token', 'missing-receiver')).rejects.toBeInstanceOf(NotFoundException);
  });
});
