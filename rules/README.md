# Master Design Document

## Core Architecture
- Engine: Decoupled, Headless TypeScript (Boardgame.io).

- State: Fully serialized JSON with "Secret State" support for hidden information.

- Players: Agnostic (2+ players).

- Victory: Point-based with a turn limit. Highest score wins.

## Card Types
- Units: Based on historical figures. Stats (STR, CUN, CHA) default to 5. Attributes: Scientist, Politician, Engineer, Warrior, Spiritual.

- Missions: Main VP source. Some have duration (hold for X turns).

- Equipment: Augments units or stored in HQ.

- Events: One-time use, passive, or Traps (face-down triggers).

- Policies: Static global modifiers. Selected at start or seeded.

## Keyword System
- Static: Passive effects.

- Triggered: Uses an event bus (e.g., "On Play", "On Attack").

## Mechanics
- Seeding Phase: Drafting from private collections and a shared face-down pool.

- Automation: Headless simulations for balance and win-rate testing.

## Variants
### Baseline Variant (Default)
- Players: 2

- Turn Limit: 10 Turns

- Victory Condition: First to 50 Victory Points or highest score at Turn 10.

- Starting Hand: 5 cards.

- Resource Generation: Standard (1 per turn).
Variants
Baseline Variant (Default)

- Turn Limit: 20 Turns

- Victory Condition: First to 50 Victory Points or highest score at Turn 20.

- Starting Hand: 5 cards.
