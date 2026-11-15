// The canonical opencode plugin lives in the server assets so the Torrix
// installer serves the exact same file to users. This loader keeps the Torrix
// repository's own opencode session working; do not copy it to install.
//
// It forwards a cache-busting query (used by the plugin tests) to the asset so
// each import re-reads the environment and ~/.torrix/opencode.json.
const asset = new URL("../../packages/server/src/assets/opencode-torrix.plugin.js", import.meta.url);
asset.search = new URL(import.meta.url).search;

export default (await import(asset.href)).default;
