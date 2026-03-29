/** Browser stub — engine filesystem functions are not used by the web client. */
export function join(...parts: string[]): string {
  return parts.join("/");
}

export function resolve(...parts: string[]): string {
  return parts.join("/");
}
