/**
 * Backup-contact rules and the typed failures they raise. Split out of the service so the controller, the specs
 * and the shared body schemas can name the same limit without importing the whole service (CB-042).
 */
import { InvalidRequestError, DomainError } from '../../shared/validation/domain-error';

/** BRD FR-BAK-03: five active backup contacts per receiver, no more. */
export const MAX_ACTIVE_BACKUP_CONTACTS = 5;
export const BACKUP_CONTACT_LIMIT_REACHED_CODE = 'BACKUP_CONTACT_LIMIT_REACHED';
export const BACKUP_CONTACT_LIMIT_REACHED_MESSAGE = `A receiver can have at most ${MAX_ACTIVE_BACKUP_CONTACTS} active backup contacts`;
export const BACKUP_CONTACT_FIELD_INVALID_CODE = 'BACKUP_CONTACT_FIELD_INVALID';

/**
 * 409: the sender asked for a sixth active backup contact. A rule the caller can act on, not a server fault —
 * before CB-042 this was a plain `Error` and the app saw a 500.
 */
export class BackupContactLimitReachedError extends DomainError {
  constructor() {
    super(BACKUP_CONTACT_LIMIT_REACHED_CODE, BACKUP_CONTACT_LIMIT_REACHED_MESSAGE, 409, {
      limit: String(MAX_ACTIVE_BACKUP_CONTACTS),
    });
  }
}

/** 400: a field the request must carry was missing or blank once trimmed. */
export class BackupContactFieldError extends InvalidRequestError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(BACKUP_CONTACT_FIELD_INVALID_CODE, message, { field });
  }
}
