import type { Action } from "cards-engine";

export interface ActionGroup {
  type: string;
  label: string;
  actions: Action[];
}

const LABELS: Record<string, string> = {
  pass: "Pass",
  draw: "Draw",
  deploy: "Deploy",
  buy: "Buy",
  enter: "Enter Grid",
  move: "Move",
  attack: "Attack",
  play_event: "Play Event",
  equip: "Equip",
  destroy: "Destroy",
  raze: "Raze",
  attempt_mission: "Attempt Mission",
  activate: "Activate",
  seed_draw: "Draw",
  seed_keep: "Keep/Expose",
  seed_steal: "Steal",
  seed_place_location: "Place Location",
  policy_select: "Select Policy",
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
    label: LABELS[type] ?? type,
    actions: acts,
  }));
}

type NameResolver = (id: string) => string;
type CellNameResolver = (row: number, col: number) => string | undefined;

function idOrName(id: string, n?: NameResolver): string {
  return n?.(id) ?? id;
}

/** Render row/col as "Location Name (row,col)" when a cell-name resolver is supplied
 *  and the cell has a location, otherwise just "(row,col)". */
function cellLabel(row: number, col: number, c?: CellNameResolver): string {
  const name = c?.(row, col);
  return name ? `${name} (${row},${col})` : `(${row},${col})`;
}

export function describeAction(
  action: Action,
  n?: NameResolver,
  c?: CellNameResolver,
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
    case "destroy":
      return `Destroy ${idOrName(action.cardId, n)}`;
    case "raze":
      return `Raze ${cellLabel(action.row, action.col, c)}`;
    case "attempt_mission":
      return `Attempt mission at ${cellLabel(action.row, action.col, c)}`;
    case "activate":
      return `Activate ${idOrName(action.cardId, n)}: ${action.actionName}`;
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
    default:
      return (action as { type: string }).type;
  }
}
