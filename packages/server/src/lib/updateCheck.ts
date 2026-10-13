import type { Repositories } from "../repos";

export function updateCommand(docker: boolean): string {
  return docker ? "docker compose pull && docker compose up -d" : "curl -fsSL https://raw.githubusercontent.com/TorrixAI/torrix/main/deploy/install.sh | sh";
}

/**
 * Queries GitHub Releases for the configured repository and persists the
 * latest tag in instance_config as `update_available`. Set
 * `TORRIX_UPDATE_REPO=owner/repo` to enable; without it the check is skipped
 * so the rebuild never adopts a version number from another product line.
 * Network failure is not an error: the check is best effort.
 */
export async function checkForUpdate(repos: Repositories, repository: string): Promise<string | null> {
  const repo = repository.trim();
  if (!repo) {
    return null;
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "torrix" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { tag_name?: unknown };
    const latest = String(body.tag_name ?? "").replace(/^v/, "").trim();
    if (!latest) {
      return null;
    }
    await repos.instance.set("update_available", latest);
    return latest;
  } catch {
    return null;
  }
}
