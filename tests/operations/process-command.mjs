import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// npm/npx are .cmd shims on Windows, which cannot be spawned without a
// shell. Invoke their JavaScript entry points with Node instead. Arguments
// stay separate, including paths with spaces; native executables stay native.
export function resolveCommand(
  command,
  args,
  {
    platform = process.platform,
    node = process.execPath,
    npmExecPath = process.env.npm_execpath,
  } = {},
) {
  if (platform !== "win32" || !["npm", "npx"].includes(command)) {
    return { command, args };
  }
  const npmBin = npmExecPath
    ? dirname(npmExecPath)
    : join(dirname(node), "node_modules", "npm", "bin");
  return { command: node, args: [join(npmBin, `${command}-cli.js`), ...args] };
}

export function spawnCommandSync(command, args, options = {}) {
  const resolved = resolveCommand(command, args);
  if (resolved.command !== command && !existsSync(resolved.args[0])) {
    throw new Error(`Missing ${command} CLI; run this check through npm run`);
  }
  return spawnSync(resolved.command, resolved.args, {
    windowsHide: true,
    ...options,
    shell: false,
  });
}
