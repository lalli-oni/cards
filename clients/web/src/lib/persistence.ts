import { get, set, del, keys } from "idb-keyval";
import type { Session } from "cards-engine";

const PREFIX = "session-";
const AUTOSAVE_KEY = "autosave";

export async function autoSave(session: Session): Promise<void> {
  await set(AUTOSAVE_KEY, session);
}

export async function saveSession(
  name: string,
  session: Session,
): Promise<void> {
  await set(PREFIX + name, session);
}

export async function loadSession(
  key: string,
): Promise<Session | undefined> {
  return get<Session>(key);
}

export async function deleteSession(key: string): Promise<void> {
  await del(key);
}

export async function listSessions(): Promise<string[]> {
  const allKeys = await keys();
  const sessionKeys = (allKeys as string[]).filter(
    (k) => k === AUTOSAVE_KEY || k.startsWith(PREFIX),
  );
  return sessionKeys;
}
