# Family Check-In

A daily safety check-in app for families, focused on the GCC region (UAE, Saudi Arabia, Qatar).

## Problem

Expats worry about loved ones (elderly parents, partners, children) who may not respond for extended periods. Existing solutions are US-centric, SMS-only, and don't support WhatsApp or multiple languages.

## Solution

A daily check-in system where:
- Loved ones confirm they're OK with one tap
- If no response, alerts escalate automatically (Push → WhatsApp → SMS → Voice)
- Family members are notified before emergencies escalate

## Project Structure

```
├── frontend/          # React Native (Expo) mobile app
│   ├── src/
│   │   ├── app/       # Expo Router screens
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── theme/
│   │   └── i18n/
│   └── assets/
├── backend/           # Supabase (Edge Functions, Migrations)
│   └── supabase/
│       ├── functions/
│       └── migrations/
├── shared/            # Shared types & constants
│   ├── types/
│   └── constants/
└── docs/              # Documentation
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native + Expo |
| Navigation | Expo Router |
| Backend | Supabase (PostgreSQL + Edge Functions) |
| Auth | Supabase Auth (Email, Apple, Google) |
| Messaging | Twilio (WhatsApp, SMS, Voice) |
| Push | Expo Notifications (FCM + APNs) |
| Subscriptions | RevenueCat |

## MVP Scope (Phase 1)

- [x] Project setup & structure
- [ ] Authentication (Email + Social)
- [ ] One-way check-in flow
- [ ] Single loved one support
- [ ] Push + WhatsApp notifications
- [ ] Basic escalation (3 steps)
- [ ] English + Arabic languages

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Supabase CLI (`npm install -g supabase`)
- iOS Simulator / Android Emulator / Expo Go app

### Installation

```bash
# Install dependencies
cd frontend && npm install

# Start the app
npm start
```

### Environment Variables

Create `frontend/.env`:
```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Subscription Tiers

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Push notifications only |
| One-Way | $9.99/mo | WhatsApp + SMS, single loved one |
| Two-Way | $14.99/mo | Mutual monitoring |
| Pro Family | $24.99/mo | Voice calls, multiple loved ones |

## License

Private - All rights reserved
