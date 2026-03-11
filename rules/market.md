# Market Rules

The market is a shared pool of purchasable cards available during the Main Phase.

## Initializing
At the start of the Main Phase players populate the market by drawing [var:market_draw_count:3] cards each and placing them in the market area.

### Event draw mechanic
When a player draws cards to populate the market, apply the following special handling for Event cards:

1. The drawing player does not reveal Event cards drawn for market population. Instead they immediately place each drawn Event into their hand (face-down to other players).
2. The drawing player continues drawing until they draw a non-Event card. The first non-Event card drawn is placed into the market slot.

## Gold and Costs
To buy a card from the market a player must pay one of the listed costs to add it to their hand.

Cards can have more than one cost but player only has to pay one of them.

The market slot is immediately replaced by drawing from the active players deck.

## Optional Variants

The static shop model is the default because of its simplicity, but the
rules support these optional variants if players prefer more interaction
or economic flavour:

* **Rotating Draft Market** – During seeding and/or each round, perform
  a snake draft of X cards to refill the market, giving players a choice
  order rather than paying gold immediately.
* **Dynamic Pricing** – Maintain a small track next to the market to
  record how many times each card type has been bought.  Increase a
  card’s cost by 1 each time it is purchased; reset when shuffled back
  into the supply.
* **Personal Shop** – Each player also has a personal three‑card shop
  drawn from their own library; they may sell unwanted cards to other
  players for gold equal to half the printed cost (rounded down).

Variants may be combined, but always remember that costs remain fixed
per card unless a policy or variant specifically modifies them.

---

The market system and gold economy give players strategic decisions
outside of card effects.  Designers should assign costs thoughtfully and
play‑test to ensure rarer cards aren’t automatically expensive and that
gold sinks remain meaningful.