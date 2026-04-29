export interface CreateBackupContactRecordInput {
  userId: string;
  receiverId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  phoneHash: string;
  relationshipToReceiver: string;
  locationInstructionsEncrypted?: string;
  priorityOrder: number;
}

export interface UpdateBackupContactRecordInput {
  userId: string;
  receiverId: string;
  backupContactId: string;
  nameEncrypted: string;
  phoneEncrypted?: string;
  phoneHash?: string;
  relationshipToReceiver: string;
  locationInstructionsEncrypted?: string | null;
}

export interface DeleteBackupContactRecordInput {
  userId: string;
  receiverId: string;
  backupContactId: string;
  deletedAt: Date;
}

export interface BackupContactRecord {
  id: string;
  receiverId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  phoneHash: string;
  relationshipToReceiver: string;
  locationInstructionsEncrypted?: string;
  priorityOrder: number;
  deletedAt?: Date;
  createdAt: Date;
}

export interface BackupContactsRepository {
  findManyForReceiverForUser(input: { userId: string; receiverId: string }): Promise<BackupContactRecord[] | null>;
  countActiveForReceiverForUser(input: { userId: string; receiverId: string }): Promise<number | null>;
  createForReceiverForUser(input: CreateBackupContactRecordInput): Promise<BackupContactRecord | null>;
  updateForReceiverForUser(input: UpdateBackupContactRecordInput): Promise<BackupContactRecord | null>;
  deleteForReceiverForUser(input: DeleteBackupContactRecordInput): Promise<BackupContactRecord | null>;
}
