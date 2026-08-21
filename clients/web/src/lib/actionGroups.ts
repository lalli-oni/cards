import type { Action } from "cards-engine";

export interface ActionGroup {
  type: string;
  label: string;
  actions: Action[];
}

const LABELS: Record<Action["type"], string> = {
  pass: "Pass",
  draw: "Draw",
  deploy: "Deploy",
  buy: "Buy",
  enter: "Enter Grid",
  move: "Move",
  attack: "Attack",
  play_event: "Play Event",
  equip: "Equip",
  unequip: "Unequip",
  transfer: "Transfer",
  destroy: "Destroy",
  raze: "Raze",
  attempt_mission: "Attempt Mission",
  activate: "Activate",
  seed_draw: "Draw",
  seed_keep: "Keep/Expose",
  seed_steal: "Steal",
  seed_place_location: "Place Location",
  policy_select: "Select Policy",
  // Prompt-driven actions. They never reach the action panel — the combat,
  // pick and view overlays submit them — but the union is exhaustive so a new
  // action type can't be added without deciding on its label.
  resolve_pick: "Resolve Pick",
  dismiss_view: "Dismiss",
  resolve_combat_round: "Resolve Combat",
};

export function groupActions(actions: Action[]): ActionGroup[] {
  const groups = new Map<string, Action[]>();

  for (const action of actions) {
    const existing = groups.get(action.type);
    if (existing) {
      existing.push(action);
    } else {
      groups.set(action.type, [action]);
    }
  }

  return Array.from(groups.entries()).map(([type, acts]) => ({
    type,
    label: LABELS[type as Action["type"]] ?? type,
    actions: acts,
  }));
}

type NameResolver = (id: string) => string;
type CellNameResolver = (row: number, col: number) => string | null | undefined;

function idOrName(id: string, n?: NameResolver): string {
  return n?.(id) ?? id;
}

/** Render row/col as "Location Name (row,col)" when a cell-name resolver is supplied
 *  and the cell has a location, otherwise just "(row,col)". */
function cellLabel(row: number, col: number, c?: CellNameResolver): string {
  const name = c?.(row, col);
  return name ? `${name} (${row},${col})` : `(${row},${col})`;
}

/** Name of the unit bearing an item, for actions that don't carry a unitId. */
export type BearerResolver = (itemId: string) => string | null;

export function describeAction(
  action: Action,
  n?: NameResolver,
  c?: CellNameResolver,
  b?: BearerResolver,
): string {
  switch (action.type) {
    case "pass":
      return "Pass";
    case "draw":
      return "Draw a card";
    case "deploy":
      return `Deploy ${idOrName(action.cardId, n)}`;
    case "buy":
      return `Buy ${idOrName(action.cardId, n)}`;
    case "enter":
      return `Enter ${idOrName(action.unitId, n)} at ${cellLabel(action.row, action.col, c)}`;
    case "move":
      return `Move ${idOrName(action.unitId, n)} to ${cellLabel(action.row, action.col, c)}`;
    case "attack":
      return `Attack ${cellLabel(action.row, action.col, c)} with ${action.unitIds.map((id) => idOrName(id, n)).join(", ")}`;
    case "play_event":
      return `Play ${idOrName(action.cardId, n)}${action.targetId ? ` on ${idOrName(action.targetId, n)}` : ""}`;
    case "equip":
      return `Equip ${idOrName(action.itemId, n)} on ${idOrName(action.unitId, n)}`;
    case "unequip": {
      // No unitId on the action, so two co-located units each bearing a
      // same-named item would otherwise produce identical rows. Same reason
      // the activate case below surfaces its target.
      const bearer = b?.(action.itemId);
      return `Unequip ${idOrName(action.itemId, n)}${bearer ? ` from ${bearer}` : ""}`;
    }
    case "transfer":
      return `Transfer ${idOrName(action.itemId, n)} to ${idOrName(action.unitId, n)}`;
    case "destroy":
      return `Destroy ${idOrName(action.cardId, n)}`;
    case "raze":
      return `Raze ${cellLabel(action.row, action.col, c)}`;
    case "attempt_mission":
      return `Attempt mission at ${cellLabel(action.row, action.col, c)}`;
    case "activate": {
      // Activate actions that resolve to multiple variants (e.g. `move(self)`
      // on Marco Polo / Alexander / Ibn Battuta, or multi-target contests)
      // arrive in the action list as duplicate rows differing only by
      // targetCell / targetId. Surface the target so the player can tell
      // them apart.
      let label = `Activate ${idOrName(action.cardId, n)}: ${action.actionName}`;
      if (action.targetCell) {
        label += ` → ${cellLabel(action.targetCell.row, action.targetCell.col, c)}`;
      } else if (action.targetId) {
        label += ` → ${idOrName(action.targetId, n)}`;
      }
      return label;
    }
    case "seed_draw":
      return "Draw seeding cards";
    case "seed_keep":
      return "Confirm keep/expose";
    case "seed_steal":
      return `Steal ${idOrName(action.cardId, n)}`;
    case "seed_place_location":
      return `Place location at ${cellLabel(action.row, action.col, c)}`;
    case "policy_select":
      return "Confirm policy";
    // Submitted by the overlays, never listed in the action panel — named here
    // only so the exhaustiveness guard below stays satisfiable.
    case "resolve_pick":
    case "dismiss_view":
    case "resolve_combat_round":
      return LABELS[action.type];
    default: {
      const _exhaustive: never = action;
      return (action as { type: string }).type;
    }
  }
}
