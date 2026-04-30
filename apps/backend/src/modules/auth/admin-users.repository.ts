import type { AdminRole } from '@prisma/client';

export interface AdminUserRecord {
  id: string;
  authProviderId: string;
  role: AdminRole;
  active: boolean;
}

export interface AdminUsersRepository {
  findByAuthProviderId(authProviderId: string): Promise<AdminUserRecord | null>;
}
