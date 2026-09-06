import type { AppendAuditLogInput, AuditLogRecord, AuditRepository } from '../../modules/audit/audit.repository';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * In-memory `AuditRepository` for specs. `events` holds every accepted input in order so a spec can assert
 * on the audit trail without a database.
 */
export class InMemoryAuditRepository implements AuditRepository {
  public readonly events: AppendAuditLogInput[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async append(input: AppendAuditLogInput): Promise<AuditLogRecord> {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      createdAt: this.now(),
      ...input,
    };
  }
}

export interface RealAuditHarness {
  /** The production `AuditService`, PII guard included, over the in-memory repository. */
  auditService: AuditService;
  /** Everything `auditService` accepted, in order (`audit.events`). */
  audit: InMemoryAuditRepository;
}

/**
 * Builds the real `AuditService` for service specs. A stubbed audit service never runs the PII guard, which is
 * how a guard that rejected `backupContactId` shipped green while every HELP escalation failed in production;
 * wire this instead so the guard is exercised on every audited path.
 */
export function createRealAuditService(now?: () => Date): RealAuditHarness {
  const audit = new InMemoryAuditRepository(now);

  return { auditService: new AuditService(audit), audit };
}
