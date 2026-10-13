import { expect, test } from "bun:test";
import { updateCommand } from "../src/lib/updateCheck";

test("the update command never pipes a script from a domain the project does not control", () => {
  const command = updateCommand(false);
  expect(command).toBe("curl -fsSL https://raw.githubusercontent.com/TorrixAI/torrix/main/deploy/install.sh | sh");
  expect(command).not.toContain("torrix.ai");
});

test("Docker installs are told to pull the image", () => {
  expect(updateCommand(true)).toBe("docker compose pull && docker compose up -d");
});
