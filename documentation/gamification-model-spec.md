# Gamification Data Model Specification

## Overview
The Gamification module tracks user engagement with properties through a "Tinder-like" swiping interface. This data is used to calculate "Heat Scores" and qualify leads based on their activity.

## Schema

### 1. SwipeSession
Represents a single "game" session where a user swipes through a deck of properties.

```prisma
model SwipeSession {
  id            String    @id @default(cuid())
  
  // User Identity
  contactId     String?   // Linked if user is identified
  contact       Contact?  @relation(fields: [contactId], references: [id])
  anonymousKey  String?   // Cookie/Device ID for anonymous users
  
  // Context
  locationId    String?
  location      Location? @relation(fields: [locationId], references: [id])
  
  // Session Metrics
  startedAt     DateTime  @default(now())
  endedAt       DateTime?
  totalSwipes   Int       @default(0)

  // Relations
  swipes        PropertySwipe[]

  @@index([contactId])
  @@index([anonymousKey])
}
```

### 2. PropertySwipe
Stores each individual decision made by a user on a property.

```prisma
model PropertySwipe {
  id          String       @id @default(cuid())
  
  // Relations
  sessionId   String
  session     SwipeSession @relation(fields: [sessionId], references: [id])
  contactId   String?
  contact     Contact?     @relation(fields: [contactId], references: [id])
  propertyId  String
  property    Property     @relation(fields: [propertyId], references: [id])
  
  // Decision
  choice      String       // "INTERESTED", "MAYBE", "NOT"
  score       Int          // 2 (Interested), 1 (Maybe), 0 (Not)
  
  createdAt   DateTime     @default(now())

  @@index([sessionId])
  @@index([contactId])
  @@index([propertyId])
}
```

## Key Concepts

### Session Tracking
-   **Anonymous vs. Identified**: Users can start swiping anonymously. An `anonymousKey` (stored in a cookie) tracks their session. If they later sign up or log in, their `SwipeSession` and `PropertySwipe` records can be linked to their `Contact` record.
-   **Session Boundaries**: A session is defined by a continuous period of activity. Logic for "ending" a session (e.g., timeout) is handled by the application layer.

### Scoring System
-   **INTERESTED**: +2 points. Strong signal of intent.
-   **MAYBE**: +1 point. Potential interest.
-   **NOT**: 0 points. Explicit disinterest.

### Aggregation
The raw data from `PropertySwipe` is aggregated into:
1.  **Contact Metrics**: `interestedCount`, `maybeCount`, `notCount`, `heatScore` on the `Contact` model.
2.  **Role Metrics**: `interestedSwipes`, `propertyHeatScore` on the `ContactPropertyRole` model.

## Integration Flow

1.  **Start Session**: Frontend creates a `SwipeSession` when the user enters the game mode.
2.  **Swipe**: Each swipe sends a request to create a `PropertySwipe` record.
3.  **Update Aggregates**: 
    -   Background jobs or triggers update the `Contact` and `ContactPropertyRole` counters.
    -   High-value actions (e.g., "INTERESTED") may trigger immediate GHL sync or notifications.
