# Attributes

Attributes are cross-card-type categorical labels that drive synergy. A
Military unit, a Military event, and a Military policy all share the
**Military** attribute, and so reference and reward one another. Attributes are
the common axis along which cards target each other across types.

## What an attribute is

- **Non-mechanical.** An attribute carries no built-in effect. It is something
  effects *target* — "All Military units get +2 strength" — never an effect in
  itself.
- **Multi-valued.** A card carries zero or more attributes.
- **A closed, unordered set.** Only the ten values below are legal, and order
  carries no meaning — `Knowledge; Military` and `Military; Knowledge` are the
  same.

## The attributes

| Attribute | Concerns |
|---|---|
| **Knowledge** | scholarship, libraries, discovery, research |
| **Military** | warfare, generals, fortifications, weapons, sieges |
| **Diplomacy** | envoys, embassies, treaties, accords |
| **Commerce** | merchants, markets, trade goods, economy |
| **Politics** | rulers, courts, succession, statecraft |
| **Spirituality** | clergy, temples, ritual, relics |
| **Engineering** | engineers, workshops, great works, machines |
| **Exploration** | navigators, frontiers, expeditions, cartography |
| **Espionage** | spies, hideouts, plots, ciphers |
| **Culture** | artists, theatres, festivals, masterworks |

The set is deliberately structural and age-agnostic — each value names a
*sphere* a card belongs to, not a specific role or era, so the same label fits a
classical general and a modern one, a unit and an event alike.

## Attributes vs. keywords

Attributes are not the only label a card carries; keep them distinct from
keywords:

- **Attributes** (this file) — the *cross-type* synergy axis. The same
  vocabulary means the same thing on every card type.
- **Keywords** — mechanical keyword-effects (Lethal, Taunt, Fortified, …),
  defined in the [Keyword Glossary](README.md#keyword-system). Unlike an
  attribute, a keyword *does* something; it is not a classifier.

[design: A third, *per-type* classifier — **subtypes** (a location's type, an
event's type, an item's type) — is distinct from the cross-type attributes
defined here, but is not yet a governed vocabulary; today it is flavor only.
Governing the subtype lists and designing cards that mechanically reference them
is tracked post-v0.1 in #160.]
