export function spawnCommandSync(
  command: string,
  args: string[],
  options?: import("node:child_process").SpawnSyncOptions,
): import("node:child_process").SpawnSyncReturns<Buffer>;
