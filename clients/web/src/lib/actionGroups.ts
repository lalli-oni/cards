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

export function describeAction(action: Action): string {
  switch (action.type) {
    case "pass":
      return "Pass";
    case "draw":
      return "Draw a card";
    case "deploy":
      return `Deploy ${action.cardId}`;
    case "buy":
      return `Buy ${action.cardId}`;
    case "enter":
      return `Enter ${action.unitId} at (${action.row},${action.col})`;
    case "move":
      return `Move ${action.unitId} to (${action.row},${action.col})`;
    case "attack":
      return `Attack (${action.row},${action.col}) with ${action.unitIds.length} unit(s)`;
    case "play_event":
      return `Play ${action.cardId}${action.targetId ? ` on ${action.targetId}` : ""}`;
    case "equip":
      return `Equip ${action.itemId} on ${action.unitId}`;
    case "destroy":
      return `Destroy ${action.cardId}`;
    case "raze":
      return `Raze at (${action.row},${action.col})`;
    case "attempt_mission":
      return `Attempt mission at (${action.row},${action.col})`;
    case "activate":
      return `Activate ${action.cardId}: ${action.actionName}`;
    case "seed_draw":
      return "Draw seeding cards";
    case "seed_keep":
      return "Confirm keep/expose";
    case "seed_steal":
      return `Steal ${action.cardId}`;
    case "seed_place_location":
      return `Place location at (${action.row},${action.col})`;
    case "policy_select":
      return "Confirm policy";
    default:
      return (action as { type: string }).type;
  }
}
