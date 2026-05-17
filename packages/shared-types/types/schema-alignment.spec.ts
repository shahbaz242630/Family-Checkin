import type { ConsentStatus, RelationshipType, SubscriptionStatus, SubscriptionTier, TechProfile } from './index';
import { describe, expect, it } from 'vitest';

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type _TechProfileMatchesPrisma = Assert<Equal<TechProfile, 'WHATSAPP' | 'SMS' | 'VOICE_ONLY' | 'LANDLINE'>>;
type _ConsentStatusMatchesPrisma = Assert<Equal<ConsentStatus, 'PENDING' | 'GRANTED' | 'DECLINED' | 'REVOKED'>>;
type _RelationshipTypeMatchesPrisma = Assert<
  Equal<RelationshipType, 'PARENT' | 'GRANDPARENT' | 'SIBLING' | 'SPOUSE' | 'CHILD' | 'FRIEND' | 'OTHER'>
>;
type _SubscriptionTierMatchesPrisma = Assert<Equal<SubscriptionTier, 'TIER_1' | 'TIER_2' | 'TIER_3'>>;
type _SubscriptionStatusMatchesPrisma = Assert<
  Equal<SubscriptionStatus, 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED'>
>;

describe('shared type schema alignment', () => {
  it('keeps Prisma enum contracts compile-time checked', () => {
    expect(true).toBe(true);
  });
});
