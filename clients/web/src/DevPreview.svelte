<script lang="ts">
  import {
    createInstanceCounter,
    instantiateCards,
    type Card,
    type CardDefinition,
    type Grid,
    type ItemCard,
    type LocationCard,
    type UnitCard,
    type PolicyCard,
    type Trap,
    type TrapEventCard,
    type ActivePassiveEvent,
    type VisibleState,
    type PlayerState,
    type OpponentView,
    type TurnState,
    type GameConfig,
    type LocationEdges,
  } from "cards-engine";
  import cardDefsJson from "@library/all.json";
  import GridBoard from "./components/GridBoard.svelte";
  import PlayerHud from "./components/PlayerHud.svelte";
  import CardListPanel from "./components/CardListPanel.svelte";
  import ActionPanel from "./components/ActionPanel.svelte";

  const defs = cardDefsJson as CardDefinition[];
  const counter = createInstanceCounter();
  const p1 = "p1";
  const p2 = "p2";

  // Instantiate cards by type
  const unitDefs = defs.filter((d) => d.type === "unit");
  const locDefs = defs.filter((d) => d.type === "location");
  const itemDefs = defs.filter((d) => d.type === "item");
  const eventDefs = defs.filter((d) => d.type === "event");
  const policyDefs = defs.filter((d) => d.type === "policy");

  const p1Units = instantiateCards(unitDefs.slice(0, 5), p1, counter) as UnitCard[];
  const p2Units = instantiateCards(unitDefs.slice(5, 10), p2, counter) as UnitCard[];
  const locations = instantiateCards(locDefs.slice(0, 9), p1, counter) as LocationCard[];
  const p1Items = instantiateCards(itemDefs.slice(0, 3), p1, counter) as ItemCard[];
  const p2Items = instantiateCards(itemDefs.slice(3, 5), p2, counter) as ItemCard[];
  const p1Policies = instantiateCards(policyDefs.slice(0, 1), p1, counter) as PolicyCard[];
  const p2Policies = instantiateCards(policyDefs.slice(1, 2), p2, counter) as PolicyCard[];

  // Assign edges to locations (they don't come from the library)
  const edgePatterns: LocationEdges[] = [
    { n: true, e: true, s: false, w: true },
    { n: true, e: false, s: true, w: true },
    { n: false, e: false, s: true, w: true },
    { n: true, e: true, s: true, w: false },
    { n: true, e: false, s: false, w: true },
    { n: false, e: true, s: true, w: false },
    { n: true, e: true, s: true, w: true },
    { n: false, e: false, s: false, w: false },
    { n: true, e: false, s: true, w: true },
  ];
  for (let i = 0; i < locations.length; i++) {
    locations[i].edges = edgePatterns[i % edgePatterns.length];
  }

  // Set up unit states for testing
  p1Units[1].injured = true; // second unit injured
  p1Items[0].equippedTo = p1Units[0].id; // equip first item to first unit
  p2Items[0].equippedTo = p2Units[0].id;

  // Build 3x3 grid
  const grid: Grid = Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => ({
      location: locations[r * 3 + c] ?? null,
      units: [] as UnitCard[],
      items: [] as ItemCard[],
    })),
  );

  // Place units and items on grid
  grid[0][0].units.push(p1Units[0], p1Units[1]); // two p1 units at top-left
  grid[0][0].items.push(p1Items[0]); // equipped item follows unit
  grid[0][1].units.push(p2Units[0]); // opponent at top-middle
  grid[0][1].items.push(p2Items[0]); // equipped item follows unit
  grid[1][1].units.push(p2Units[1]); // opponent at center
  grid[1][0].items.push(p1Items[1]); // loose item

  // Hand cards
  const handCards = instantiateCards([...unitDefs.slice(10, 12), ...itemDefs.slice(5, 7)], p1, counter);

  // Trap & passive event for HUD testing
  const trapDefs = eventDefs.filter((d) => "subtype" in d || d.type === "event");
  const trapCards = instantiateCards(trapDefs.slice(0, 1), p1, counter);
  const trapCard = trapCards[0] as TrapEventCard;
  const mockTrap: Trap = { card: { ...trapCard, subtype: "trap", trigger: "Unit enters" } as TrapEventCard, targetId: locations[0]?.id };

  const passiveCards = instantiateCards(eventDefs.slice(1, 2), p1, counter);
  const mockPassive: ActivePassiveEvent = {
    ...(passiveCards[0] as any),
    subtype: "passive",
    duration: 3,
    remainingDuration: 2,
    targetId: locations[3]?.id,
  };

  // Build visible state
  const selfState: PlayerState = {
    id: p1, name: "Player 1", gold: 12, vp: 8,
    hand: handCards,
    seedingDeck: [], mainDeck: Array(18).fill(null), marketDeck: Array(4).fill(null),
    prospectDeck: Array(6).fill(null), discardPile: Array(3).fill(null), removedFromGame: [],
    hq: [p1Units[2]],
    activePolicies: p1Policies,
    activeTraps: [mockTrap],
    passiveEvents: [mockPassive],
    policyPool: [],
  };

  const opponentView: OpponentView = {
    id: p2, name: "Player 2", gold: 9, vp: 5,
    handSize: 4, seedingDeckSize: 0, mainDeckSize: 14, marketDeckSize: 3,
    prospectDeckSize: 5, discardPileSize: 2,
    hq: [p2Units[2]],
    activePolicies: p2Policies,
    activeTraps: [{ targetId: locations[1]?.id }],
  };

  const turn: TurnState = { activePlayerId: p1, actionPointsRemaining: 2, round: 3 };
  const config: GameConfig = { starting_gold: 10, grid_padding: 2, action_points_per_turn: 3 };

  const marketCards = instantiateCards([...unitDefs.slice(12, 13), ...itemDefs.slice(7, 8)], "market", counter);

  const vs: VisibleState = {
    config, phase: "main", turn,
    currentPlayerId: p1, playerId: p1,
    self: selfState, teammates: [], opponents: [opponentView],
    grid, market: marketCards,
    turnOrder: [p1, p2], middleArea: [],
  };

  const mockActions = [
    { type: "move", playerId: p1, unitId: p1Units[0].id, row: 1, col: 0 },
    { type: "move", playerId: p1, unitId: p1Units[0].id, row: 0, col: 1 },
    { type: "attack", playerId: p1, unitIds: [p1Units[0].id], row: 0, col: 1 },
    { type: "deploy", playerId: p1, cardId: handCards[0].id },
    { type: "buy", playerId: p1, cardId: marketCards[0]?.id },
    { type: "pass", playerId: p1 },
  ];

  const highlightedCells = new Set(["1,0", "0,1"]);
</script>

<div class="flex h-screen flex-col gap-3 bg-surface-sunken p-4">
  <div class="text-xs text-text-faint">DEV PREVIEW — alpha-1 card data, mock game state</div>

  <PlayerHud {vs} />

  <div
    class="min-h-0 flex-1"
    style="display: grid; grid-template-columns: 12rem 1fr 16rem; grid-template-rows: 1fr auto; gap: 0.75rem;"
  >
    <!-- Market (top-left) -->
    <div class="overflow-y-auto" style="grid-row: 1; grid-column: 1;">
      <CardListPanel title="Market" cards={marketCards} highlightedIds={new Set([marketCards[0]?.id].filter(Boolean) as string[])} />
    </div>

    <!-- Grid (top-center, fills area) -->
    <div class="min-h-0" style="grid-row: 1; grid-column: 2;">
      <GridBoard {grid} selfPlayerId={p1} {highlightedCells} />
    </div>

    <!-- Right sidebar: Actions + Hand (spans both rows) -->
    <div class="flex flex-col gap-3 overflow-y-auto" style="grid-row: 1 / -1; grid-column: 3;">
      <ActionPanel actions={mockActions} />
      <CardListPanel title="Hand" cards={handCards} highlightedIds={new Set([handCards[0].id])} />
    </div>

    <!-- HQ (bottom, spans market + grid columns) -->
    <div class="overflow-x-auto" style="grid-row: 2; grid-column: 1 / 3;">
      <CardListPanel title="HQ" cards={selfState.hq} />
    </div>
  </div>
</div>
