import type { ConsentStatus, Database, RelationshipType, TechProfile } from './database.types';
import { describe, expect, it } from 'vitest';

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type _MobileTechProfileMatchesPrisma = Assert<Equal<TechProfile, 'WHATSAPP' | 'SMS' | 'VOICE_ONLY' | 'LANDLINE'>>;
type _MobileConsentStatusMatchesPrisma = Assert<Equal<ConsentStatus, 'PENDING' | 'GRANTED' | 'DECLINED' | 'REVOKED'>>;
type _MobileRelationshipTypeMatchesPrisma = Assert<
  Equal<RelationshipType, 'PARENT' | 'GRANDPARENT' | 'SIBLING' | 'SPOUSE' | 'CHILD' | 'FRIEND' | 'OTHER'>
>;
type _ReceiverRowUsesTypedPrismaEnums = Assert<
  Equal<Database['public']['Tables']['receivers']['Row']['tech_profile'], TechProfile>
>;
type _ReceiverRowUsesTypedConsentStatus = Assert<
  Equal<Database['public']['Tables']['receivers']['Row']['consent_status'], ConsentStatus>
>;

describe('database type alignment', () => {
  it('keeps Prisma enum contracts compile-time checked', () => {
    expect(true).toBe(true);
  });
});
