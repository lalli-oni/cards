/** Browser stub — engine filesystem functions are not used by the web client. */
export function existsSync(): never {
  throw new Error("node:fs is not available in the browser");
}

export function readFileSync(): never {
  throw new Error("node:fs is not available in the browser");
}

export function writeFileSync(): never {
  throw new Error("node:fs is not available in the browser");
}

export function mkdirSync(): never {
  throw new Error("node:fs is not available in the browser");
}

export function readdirSync(): never {
  throw new Error("node:fs is not available in the browser");
}
