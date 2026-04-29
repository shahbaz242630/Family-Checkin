import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import type {
  BackupContactRecord,
  BackupContactsRepository,
  CreateBackupContactRecordInput,
  UpdateBackupContactRecordInput,
} from './backup-contacts.repository';
import { BACKUP_CONTACTS_REPOSITORY } from './backup-contacts.tokens';

const MAX_ACTIVE_BACKUP_CONTACTS = 5;

export interface BackupContactSummary {
  id: string;
  displayName: string;
  phoneMasked: string;
  relationshipToReceiver: string;
  priorityOrder: number;
  hasLocationInstructions: boolean;
  createdAt: string;
}

export interface ListBackupContactsInput {
  userId: string;
  receiverId: string;
}

export interface CreateBackupContactInput extends ListBackupContactsInput {
  name: string;
  phone: string;
  phoneCountry?: string;
  relationshipToReceiver: string;
  locationInstructions?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateBackupContactInput extends ListBackupContactsInput {
  backupContactId: string;
  name: string;
  phone?: string;
  phoneCountry?: string;
  relationshipToReceiver: string;
  locationInstructions?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface DeleteBackupContactInput extends ListBackupContactsInput {
  backupContactId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class BackupContactsService {
  constructor(
    @Inject(BACKUP_CONTACTS_REPOSITORY) private readonly backupContactsRepository: BackupContactsRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
  ) {}

  async listForReceiver(input: ListBackupContactsInput): Promise<BackupContactSummary[] | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const contacts = await this.backupContactsRepository.findManyForReceiverForUser({ userId, receiverId });

    return contacts ? contacts.map((contact) => this.toSummary(contact)) : null;
  }

  async createForReceiver(input: CreateBackupContactInput): Promise<BackupContactSummary | null> {
    const normalized = this.normalizeCreateInput(input);
    const activeCount = await this.backupContactsRepository.countActiveForReceiverForUser({
      userId: normalized.userId,
      receiverId: normalized.receiverId,
    });

    if (activeCount === null) {
      return null;
    }
    if (activeCount >= MAX_ACTIVE_BACKUP_CONTACTS) {
      throw new Error('A receiver can have at most 5 active backup contacts');
    }

    const contact = await this.backupContactsRepository.createForReceiverForUser(this.toCreateRecordInput(normalized, activeCount));

    if (!contact) {
      return null;
    }

    await this.auditService.append({
      entityType: 'backup_contact',
      entityId: contact.id,
      action: 'backup_contact.created',
      actorType: ActorType.USER,
      actorId: normalized.userId,
      metadata: {
        receiverId: normalized.receiverId,
        relationshipToReceiver: normalized.relationshipToReceiver,
        priorityOrder: contact.priorityOrder,
      },
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });

    return this.toSummary(contact);
  }

  async updateForReceiver(input: UpdateBackupContactInput): Promise<BackupContactSummary | null> {
    const normalized = this.normalizeUpdateInput(input);
    const contact = await this.backupContactsRepository.updateForReceiverForUser(this.toUpdateRecordInput(normalized));

    if (!contact) {
      return null;
    }

    await this.auditService.append({
      entityType: 'backup_contact',
      entityId: contact.id,
      action: 'backup_contact.updated',
      actorType: ActorType.USER,
      actorId: normalized.userId,
      metadata: {
        receiverId: normalized.receiverId,
        relationshipToReceiver: normalized.relationshipToReceiver,
        priorityOrder: contact.priorityOrder,
      },
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });

    return this.toSummary(contact);
  }

  async deleteForReceiver(input: DeleteBackupContactInput): Promise<BackupContactSummary | null> {
    const normalized = this.normalizeDeleteInput(input);
    const contact = await this.backupContactsRepository.deleteForReceiverForUser({
      userId: normalized.userId,
      receiverId: normalized.receiverId,
      backupContactId: normalized.backupContactId,
      deletedAt: new Date(),
    });

    if (!contact) {
      return null;
    }

    await this.auditService.append({
      entityType: 'backup_contact',
      entityId: contact.id,
      action: 'backup_contact.deleted',
      actorType: ActorType.USER,
      actorId: normalized.userId,
      metadata: {
        receiverId: normalized.receiverId,
        priorityOrder: contact.priorityOrder,
      },
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });

    return this.toSummary(contact);
  }

  private normalizeCreateInput(input: CreateBackupContactInput): CreateBackupContactInput {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const name = input.name.trim();
    const phone = input.phone.trim();
    const relationshipToReceiver = input.relationshipToReceiver.trim();
    const locationInstructions = input.locationInstructions?.trim() || undefined;

    if (!userId) {
      throw new Error('Sender user id is required');
    }
    if (!receiverId) {
      throw new Error('Receiver id is required');
    }
    if (!name) {
      throw new Error('Backup contact name is required');
    }
    if (!phone) {
      throw new Error('Backup contact phone is required');
    }
    if (!relationshipToReceiver) {
      throw new Error('Backup contact relationship is required');
    }

    return {
      ...input,
      userId,
      receiverId,
      name,
      phone,
      relationshipToReceiver,
      locationInstructions,
    };
  }

  private normalizeUpdateInput(input: UpdateBackupContactInput): UpdateBackupContactInput {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const backupContactId = input.backupContactId.trim();
    const name = input.name.trim();
    const phone = input.phone?.trim() || undefined;
    const relationshipToReceiver = input.relationshipToReceiver.trim();
    const locationInstructions = input.locationInstructions?.trim() || undefined;

    if (!userId) {
      throw new Error('Sender user id is required');
    }
    if (!receiverId) {
      throw new Error('Receiver id is required');
    }
    if (!backupContactId) {
      throw new Error('Backup contact id is required');
    }
    if (!name) {
      throw new Error('Backup contact name is required');
    }
    if (!relationshipToReceiver) {
      throw new Error('Backup contact relationship is required');
    }

    return {
      ...input,
      userId,
      receiverId,
      backupContactId,
      name,
      phone,
      relationshipToReceiver,
      locationInstructions,
    };
  }

  private normalizeDeleteInput(input: DeleteBackupContactInput): DeleteBackupContactInput {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const backupContactId = input.backupContactId.trim();

    if (!userId) {
      throw new Error('Sender user id is required');
    }
    if (!receiverId) {
      throw new Error('Receiver id is required');
    }
    if (!backupContactId) {
      throw new Error('Backup contact id is required');
    }

    return {
      ...input,
      userId,
      receiverId,
      backupContactId,
    };
  }

  private toCreateRecordInput(input: CreateBackupContactInput, priorityOrder: number): CreateBackupContactRecordInput {
    const normalizedPhone = normalizePhone(input.phone, input.phoneCountry);

    return {
      userId: input.userId,
      receiverId: input.receiverId,
      nameEncrypted: this.cryptoService.encrypt(input.name),
      phoneEncrypted: this.cryptoService.encrypt(normalizedPhone),
      phoneHash: this.cryptoService.hashForLookup(normalizedPhone),
      relationshipToReceiver: input.relationshipToReceiver,
      locationInstructionsEncrypted: input.locationInstructions ? this.cryptoService.encrypt(input.locationInstructions) : undefined,
      priorityOrder,
    };
  }

  private toUpdateRecordInput(input: UpdateBackupContactInput): UpdateBackupContactRecordInput {
    const recordInput: UpdateBackupContactRecordInput = {
      userId: input.userId,
      receiverId: input.receiverId,
      backupContactId: input.backupContactId,
      nameEncrypted: this.cryptoService.encrypt(input.name),
      relationshipToReceiver: input.relationshipToReceiver,
      locationInstructionsEncrypted: input.locationInstructions ? this.cryptoService.encrypt(input.locationInstructions) : null,
    };

    if (input.phone) {
      const normalizedPhone = normalizePhone(input.phone, input.phoneCountry);
      recordInput.phoneEncrypted = this.cryptoService.encrypt(normalizedPhone);
      recordInput.phoneHash = this.cryptoService.hashForLookup(normalizedPhone);
    }

    return recordInput;
  }

  private toSummary(contact: BackupContactRecord): BackupContactSummary {
    const phone = this.cryptoService.decrypt(contact.phoneEncrypted);

    return {
      id: contact.id,
      displayName: this.cryptoService.decrypt(contact.nameEncrypted),
      phoneMasked: this.maskPhone(phone),
      relationshipToReceiver: contact.relationshipToReceiver,
      priorityOrder: contact.priorityOrder,
      hasLocationInstructions: Boolean(contact.locationInstructionsEncrypted),
      createdAt: contact.createdAt.toISOString(),
    };
  }

  private maskPhone(phone: string): string {
    return `*******${phone.slice(-4)}`;
  }
}
