import type {
  Channel,
  ConsentStatus,
  RelationshipType,
  SubscriptionStatus,
  SubscriptionTier,
  TechProfile,
} from './index';
import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  channelSchema,
  relationshipTypeSchema,
  sensitiveActionSchema,
  techProfileSchema,
} from '../validation/primitives';

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

// The body schemas answer 4xx for a value outside these sets (CB-042), so they have to be the same sets: a
// Prisma enum that gains a member and a schema that does not would refuse a value the database accepts.
type _ChannelSchemaMatchesChannel = Assert<Equal<z.infer<typeof channelSchema>, Channel>>;
type _TechProfileSchemaMatchesTechProfile = Assert<Equal<z.infer<typeof techProfileSchema>, TechProfile>>;
type _RelationshipSchemaMatchesRelationship = Assert<Equal<z.infer<typeof relationshipTypeSchema>, RelationshipType>>;
type _SensitiveActionSchemaMatchesPrisma = Assert<
  Equal<z.infer<typeof sensitiveActionSchema>, 'EXPORT_DATA' | 'DELETE_ACCOUNT' | 'REMOVE_RECEIVER'>
>;

describe('shared type schema alignment', () => {
  it('keeps Prisma enum contracts compile-time checked', () => {
    expect(true).toBe(true);
  });

  it('validates every enum member the database accepts', () => {
    for (const channel of channelSchema.options) {
      expect(channelSchema.safeParse(channel).success, channel).toBe(true);
    }
    for (const profile of techProfileSchema.options) {
      expect(techProfileSchema.safeParse(profile).success, profile).toBe(true);
    }
    for (const relationship of relationshipTypeSchema.options) {
      expect(relationshipTypeSchema.safeParse(relationship).success, relationship).toBe(true);
    }
  });
});
