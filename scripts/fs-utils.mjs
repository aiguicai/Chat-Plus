import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function removePath(targetPath) {
  if (!targetPath || !existsSync(targetPath)) {
    return;
  }

  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `if (Test-Path -LiteralPath '${escapeForPowerShell(targetPath)}') { Remove-Item -LiteralPath '${escapeForPowerShell(targetPath)}' -Recurse -Force }`,
      ],
      {
        stdio: "inherit",
      },
    );

    if (result.status !== 0) {
      throw new Error(`Failed to remove path: ${targetPath}`);
    }
  } else {
    rmSync(targetPath, { recursive: true, force: true });
  }

  if (existsSync(targetPath)) {
    throw new Error(`Path still exists after cleanup: ${targetPath}`);
  }
}

function escapeForPowerShell(value) {
  return String(value).replace(/'/g, "''");
}
