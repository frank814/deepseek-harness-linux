// Pre-launch discovery of local, keyless model servers (Ollama / LM Studio).
// Runs under Electron-as-node before the desktop shell starts, and only edits
// the user's profile patch when something is missing. It never removes a
// provider the user configured, and never touches provider profiles that
// already exist.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// fileURLToPath handles URL decoding and platform-specific path formats.
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const DSH_DIR = path.join(ROOT, "dsh");
const require = createRequire(path.join(DSH_DIR, "package.json"));
const yaml = require("js-yaml");

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const PATCH = path.join(DSH_HOME, "profiles", "desktop", "cordis.patch.yml");
// Models this script has ever offered a local route, so a list the user
// trimmed stays trimmed instead of refilling from the server on the next
// launch. Seeding bookkeeping only; the profile remains the single source of
// truth for what a route serves.
const SEED_STATE = path.join(DSH_HOME, ".local-provider-seed.json");

function readSeedState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SEED_STATE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const DISCOVERY_TIMEOUT_MS = 3000;
const EXCLUDE = /embed|embedding|nomic|tts|whisper|phonon|voice/i;

async function listModels(baseURL) {
  try {
    const response = await fetch(`${baseURL}/models`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [];
    const body = await response.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    return data
      .map((entry) => entry?.id)
      .filter((id) => typeof id === "string" && id.length > 0 && !EXCLUDE.test(id));
  } catch {
    return [];
  }
}

// A route with no key reference makes pi-ai refuse the request before it
// reaches the server, so every discovered local route names the conventional
// ref the Models page derives for it (`lmstudio` → LMSTUDIO_API_KEY). The
// launcher exports a placeholder for that ref, and a real key typed into the
// Models page or exported by the user overrides it.
//
// A local model is never rationed on output: its ceiling IS its context window,
// so the only capacity it declares is how far it can see. Nothing beyond the
// model's own limit is imposed on what it may write.
const LOCAL_CONTEXT_WINDOW = 32768;
function providerProfile(displayName, baseURL, apiKeyEnv, models) {
  return {
    displayName,
    api: "openai-completions",
    baseURL,
    apiKeyEnv,
    models: models.map((id) => ({
      id,
      name: id,
      contextWindow: LOCAL_CONTEXT_WINDOW,
      maxTokens: LOCAL_CONTEXT_WINDOW,
    })),
  };
}

async function main() {
  let entries = [];
  if (fs.existsSync(PATCH)) {
    try {
      const parsed = yaml.load(fs.readFileSync(PATCH, "utf8"));
      if (!Array.isArray(parsed)) return;
      entries = parsed;
    } catch {
      return;
    }
  }

  const found = [];
  const [ollamaModels, lmStudio1234, lmStudio1235] = await Promise.all([
    listModels("http://127.0.0.1:11434/v1"),
    listModels("http://127.0.0.1:1234/v1"),
    listModels("http://127.0.0.1:1235/v1"),
  ]);
  if (lmStudio1235.length > 0) found.push(["lmstudio", "LM Studio (local)", "http://127.0.0.1:1235/v1", "LMSTUDIO_API_KEY", lmStudio1235]);
  else if (lmStudio1234.length > 0) found.push(["lmstudio", "LM Studio (local)", "http://127.0.0.1:1234/v1", "LMSTUDIO_API_KEY", lmStudio1234]);
  if (ollamaModels.length > 0) found.push(["ollama", "Ollama (local)", "http://127.0.0.1:11434/v1", "OLLAMA_API_KEY", ollamaModels]);

  let changed = !fs.existsSync(PATCH);
  const findEntry = (id) => {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.id === id) return entry;
      if (Array.isArray(entry.insert)) {
        const inner = entry.insert.find((row) => row && row.id === id);
        if (inner !== void 0) return inner;
      }
    }
    return undefined;
  };
  // Override an entry the shipped bundles already mount; the loader skips
  // patches whose target id does not exist in the composed tree.
  const ensureEntry = (id, plugin) => {
    let entry = findEntry(id);
    if (entry === void 0) {
      entry = { id, name: plugin, config: {} };
      entries.push(entry);
      changed = true;
    }
    entry.config ??= {};
    return entry;
  };
  // Mount a plugin the shipped bundles do not know: a root-level `insert` is
  // the loader's form for adding entries (a plain entry whose id is not in the
  // composed tree would be skipped as "not found"). A plain entry left by an
  // earlier revision is migrated into the insert form here.
  const ensureMounted = (id, plugin) => {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry && typeof entry === "object" && !Array.isArray(entry.insert) && entry.id === id) {
        entries.splice(index, 1);
        changed = true;
        index -= 1;
      }
    }
    let entry = findEntry(id);
    if (entry !== void 0) {
      entry.config ??= {};
      return entry;
    }
    entry = { id, name: plugin, config: {} };
    entries.push({ insert: [entry] });
    changed = true;
    return entry;
  };

  const llm = ensureEntry("llm-pi-ai", "@deepseek-ai/dsh-llm-pi-ai");
  const providers = llm.config.providers && typeof llm.config.providers === "object" ? llm.config.providers : {};
  llm.config.providers = providers;

  // Both local routes are defaults whether or not a server is running, so
  // Settings > Models lists them from the very first launch and an Ollama or
  // LM Studio started afterwards is picked up with no reinstall. A route that
  // answered contributes its models; one that did not keeps an empty list
  // rather than vanishing from the page.
  const answered = new Map(found.map(([id, displayName, baseURL, apiKeyEnv, models]) => [id, { displayName, baseURL, apiKeyEnv, models }]));
  const localRoutes = [
    {
      id: "lmstudio",
      displayName: "LM Studio (local)",
      baseURL: "http://127.0.0.1:1235/v1",
      apiKeyEnv: "LMSTUDIO_API_KEY",
      // This machine's own LM Studio endpoints, whichever port it answered on.
      endpoints: ["http://127.0.0.1:1235/v1", "http://127.0.0.1:1234/v1"],
    },
    {
      id: "ollama",
      displayName: "Ollama (local)",
      baseURL: "http://127.0.0.1:11434/v1",
      apiKeyEnv: "OLLAMA_API_KEY",
      endpoints: ["http://127.0.0.1:11434/v1"],
    },
  ];
  const seedState = readSeedState();
  // Identifiers repaired against the provider's live catalog this launch.
  const staleRepairs = new Map();
  let seedStateDirty = false;
  // Settings > Models can delete every local provider, these two defaults
  // included. A route the user deleted is remembered here so this script does
  // not recreate it on the next launch; re-adding a provider (any name, any
  // local base URL) clears the memory again.
  const removedRoutes = new Set(Array.isArray(seedState.__removed) ? seedState.__removed : []);
  const markRemoved = (routeId) => {
    if (removedRoutes.has(routeId)) return;
    removedRoutes.add(routeId);
    seedState.__removed = [...removedRoutes];
    seedStateDirty = true;
  };
  const clearRemoved = (routeId) => {
    if (!removedRoutes.has(routeId)) return;
    removedRoutes.delete(routeId);
    seedState.__removed = [...removedRoutes];
    seedStateDirty = true;
  };
  for (const route of localRoutes) {
    const target = answered.get(route.id);
    const displayName = target?.displayName ?? route.displayName;
    const baseURL = target?.baseURL ?? route.baseURL;
    const apiKeyEnv = target?.apiKeyEnv ?? route.apiKeyEnv;
    const discovered = target?.models ?? [];
    const known = new Set(Array.isArray(seedState[route.id]) ? seedState[route.id] : []);
    const existing = providers[route.id];
    if (existing === void 0 || typeof existing !== "object") {
      // Deleted by the user: stay deleted. Otherwise a missing route is a
      // machine that has never been seeded, and gets seeded.
      if (removedRoutes.has(route.id)) continue;
      if (Array.isArray(seedState[route.id])) {
        delete seedState[route.id];
        seedStateDirty = true;
        markRemoved(route.id);
        continue;
      }
      providers[route.id] = providerProfile(displayName, baseURL, apiKeyEnv, discovered);
      for (const id of discovered) known.add(id);
      seedState[route.id] = [...known];
      seedStateDirty = true;
      changed = true;
      continue;
    }
    // Present again means the user re-added it, so it stops being remembered
    // as deleted and gets the normal discovery treatment below.
    clearRemoved(route.id);
    // The route is still ours while it still points at this machine's own
    // server: a display-name change is cosmetic and stays the user's, but an
    // endpoint they moved elsewhere is a provider they authored, so discovery
    // stands down entirely.
    if (existing.baseURL !== void 0 && !route.endpoints.includes(existing.baseURL)) continue;
    const carried = Array.isArray(existing.models) ? existing.models : [];
    // A provider can rename identifiers between launches (LM Studio now
    // reports the publisher-qualified file id). A carried id that is a strict
    // suffix of exactly one live id is the same model under its new name:
    // repair it in place, drop the stale bookkeeping, and collapse the
    // duplicate the live id may already have added — so the model list and the
    // saved default keep resolving instead of failing with
    // "Invalid model identifier".
    if (discovered.length > 0) {
      for (const model of carried) {
        if (model === null || typeof model !== "object") continue;
        const id = model.id;
        if (typeof id !== "string" || discovered.includes(id)) continue;
        const matches = discovered.filter((entry) => entry.endsWith(`/${id}`));
        if (matches.length !== 1) continue;
        staleRepairs.set(id, matches[0]);
        known.delete(id);
        model.id = matches[0];
        if (model.name === id) model.name = matches[0];
        changed = true;
      }
      if (staleRepairs.size > 0) {
        const seen = new Set();
        for (let index = 0; index < carried.length; index += 1) {
          const id = carried[index]?.id;
          if (typeof id !== "string") continue;
          if (seen.has(id)) {
            carried.splice(index, 1);
            index -= 1;
            changed = true;
          } else seen.add(id);
        }
      }
    }
    for (const model of carried) {
      if (typeof model?.id === "string") known.add(model.id);
      if (model === null || typeof model !== "object") continue;
      // No rationing: a model's output ceiling is its own context window, so
      // any capacity it leaves unstated is stated here rather than falling
      // back to a provider-wide cap.
      if (model.contextWindow === void 0) {
        model.contextWindow = LOCAL_CONTEXT_WINDOW;
        changed = true;
      }
      if (model.maxTokens === void 0) {
        model.maxTokens = model.contextWindow;
        changed = true;
      }
    }
    const carriedIds = new Set(carried.map((model) => model?.id));
    const added = [];
    for (const id of discovered) {
      if (carriedIds.has(id) || known.has(id)) continue;
      added.push({ id, name: id, contextWindow: LOCAL_CONTEXT_WINDOW, maxTokens: LOCAL_CONTEXT_WINDOW });
      known.add(id);
    }
    if (added.length > 0) {
      providers[route.id].models = [...carried, ...added];
      changed = true;
    }
    const recorded = seedState[route.id];
    if (!Array.isArray(recorded) || recorded.length !== known.size || recorded.some((id) => !known.has(id))) {
      seedState[route.id] = [...known];
      seedStateDirty = true;
    }
  }
  // A local server the user added from the Models page gets the same care as
  // the shipped defaults: whatever it now serves is folded in (a model the user
  // trimmed is never re-added), and its capacity stays the model's own context
  // window - no separate output ration. On the FIRST sight of such a provider
  // the current list is recorded as its baseline instead of being merged, so
  // models the user removed before this script ran stay removed.
  const isLocalBaseURL = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) return false;
    try {
      const { hostname } = new URL(value.trim());
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".local") || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    } catch {
      return false;
    }
  };
  for (const [routeId, profile] of Object.entries(providers)) {
    if (routeId === "lmstudio" || routeId === "ollama") continue;
    if (profile === null || typeof profile !== "object" || !isLocalBaseURL(profile.baseURL)) continue;
    const discovered = await listModels(profile.baseURL);
    const carried = Array.isArray(profile.models) ? profile.models : [];
    const carriedIds = new Set(carried.map((model) => model?.id));
    for (const model of carried) {
      if (model === null || typeof model !== "object") continue;
      if (model.contextWindow === void 0) {
        model.contextWindow = LOCAL_CONTEXT_WINDOW;
        changed = true;
      }
      if (model.maxTokens === void 0) {
        model.maxTokens = model.contextWindow;
        changed = true;
      }
    }
    const recorded = seedState[routeId];
    const known = new Set(Array.isArray(recorded) ? recorded : []);
    if (!Array.isArray(recorded)) {
      for (const id of [...carriedIds, ...discovered]) known.add(id);
    } else {
      for (const id of carriedIds) known.add(id);
      const added = [];
      for (const id of discovered) {
        if (carriedIds.has(id) || known.has(id)) continue;
        added.push({ id, name: id, contextWindow: LOCAL_CONTEXT_WINDOW, maxTokens: LOCAL_CONTEXT_WINDOW });
        known.add(id);
      }
      if (added.length > 0) {
        profile.models = [...carried, ...added];
        changed = true;
      }
    }
    if (!Array.isArray(recorded) || recorded.length !== known.size || recorded.some((id) => !known.has(id))) {
      seedState[routeId] = [...known];
      seedStateDirty = true;
    }
  }
  if (seedStateDirty) {
    fs.mkdirSync(DSH_HOME, { recursive: true });
    fs.writeFileSync(SEED_STATE, `${JSON.stringify(seedState, null, 2)}\n`, { mode: 0o600 });
  }

  // The saved default model must keep resolving after any local provider is
  // deleted: if the provider that held it is gone, repoint the default at a
  // provider that still has models, and with none left fall back to the
  // shipped DeepSeek default. Ids that are not pi-ai routes (the DeepSeek
  // adapter's own) resolve elsewhere, so they are left alone.
  const NON_PI_AI_PROVIDERS = new Set(["deepseek-official", "deepseek-account"]);
  const defaultEntry = findEntry("agent-default-model");
  if (defaultEntry !== void 0) {
    defaultEntry.config ??= {};
    const config = defaultEntry.config;
    const current = providers[config.provider];
    // A repaired identifier follows the saved default to its live name.
    if (staleRepairs.has(config.model)) {
      config.model = staleRepairs.get(config.model);
      changed = true;
    }
    let resolves = NON_PI_AI_PROVIDERS.has(config.provider);
    if (!resolves && current !== void 0 && typeof current === "object" && Array.isArray(current.models) && current.models.length > 0) {
      if (current.models.some((model) => model?.id === config.model)) resolves = true;
      else {
        // The provider survives; only that model was trimmed from it.
        config.model = current.models[0].id;
        changed = true;
        resolves = true;
      }
    }
    if (!resolves) {
      const [provider, profile] = Object.entries(providers).find(([, item]) => item !== null && typeof item === "object" && Array.isArray(item.models) && item.models.length > 0) ?? [];
      if (provider !== void 0) {
        config.provider = provider;
        config.model = profile.models[0].id;
      } else {
        config.provider = "deepseek-official";
        config.model = "deepseek-flash";
      }
      changed = true;
    }
  } else if (found.length > 0 && providers[found[0][0]] !== void 0) {
    const [provider, , , , models] = found[0];
    entries.push({
      id: "agent-default-model",
      name: "@deepseek-ai/dsh-agent-default-model",
      config: { provider, model: models[0] },
    });
    changed = true;
  }

  // Keyless search lives inside the shipped search plugin, so it only needs
  // selecting: browsing the web takes no credential, while an API-backed route
  // stays available in the config for anyone who prefers it.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    if (entry.insert !== void 0) {
      if (Array.isArray(entry.insert) && entry.insert.some((row) => row && row.id === "web-search-local")) {
        entries.splice(index, 1);
        changed = true;
        index -= 1;
      }
      continue;
    }
    if (entry.id === "web-search-local") {
      entries.splice(index, 1);
      changed = true;
      index -= 1;
    }
  }
  const web = ensureEntry("web", "@deepseek-ai/dsh-web");
  if (web.config.searchProvider !== "local-bing" || web.config.fetchProvider !== "http") {
    web.config.searchProvider = "local-bing";
    web.config.fetchProvider = "http";
    changed = true;
  }

  // --- Popular open-source MCP servers (stdio, npx-based) ---
  // Pre-configured so they appear in the Plugins section. Each uses `npx -y` to
  // auto-download the server binary on first run. Servers that need credentials
  // expose them via env vars the user fills in on the plugin config screen.
  // `failOnStartupError: false` + `reconnect.enabled: false` means a missing
  // npx or an unset env var leaves the server dormant instead of breaking the
  // host — the user configures, then reloads.
  const mcpServers = [
    {
      id: "mcp-sequential-thinking",
      serverName: "sequential-thinking",
      label: "Sequential Thinking (no config needed)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      note: "Chain-of-thought reasoning tool, zero setup required.",
    },
    {
      id: "mcp-filesystem",
      serverName: "filesystem",
      label: "Filesystem (point at a directory)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", os.homedir()],
      note: "Read / write local files under a directory of your choice.",
    },
    {
      id: "mcp-github",
      serverName: "github",
      label: "GitHub (set GITHUB_TOKEN for private repos)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "" },
      note: "Issues, PRs, code search — public repos work without a token.",
    },
    {
      id: "mcp-brave-search",
      serverName: "brave-search",
      label: "Brave Search (set BRAVE_API_KEY)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "" },
      note: "Web search tool, needs a Brave Search API key.",
    },
    {
      id: "mcp-puppeteer",
      serverName: "puppeteer",
      label: "Puppeteer (browser automation)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      note: "Headless browser automation — navigate, screenshot, fill forms.",
    },
    {
      id: "mcp-memory",
      serverName: "memory",
      label: "Memory (persistent conversation memory)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      note: "Long-term memory across sessions via a local knowledge graph.",
    },
    {
      id: "mcp-fetch",
      serverName: "fetch",
      label: "Fetch (fetch & read any URL)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      note: "Fetch and convert web pages to markdown for the model.",
    },
  ];

  for (const server of mcpServers) {
    let entry = findEntry(server.id);
    const mcpConfig = {
      transport: "stdio",
      serverName: server.serverName,
      command: server.command,
      args: server.args,
      env: server.env ?? {},
      cwd: "",
      toolCallTimeoutMs: 60000,
      failOnStartupError: false,
      reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 3 },
    };
    if (entry === void 0) {
      entry = { id: server.id, name: "@deepseek-ai/dsh-mcp-client", config: mcpConfig };
      entries.push({ insert: [entry] });
      changed = true;
    } else if (entry && typeof entry === "object") {
      // Preserve user edits, only fill in missing defaults
      entry.config ??= {};
      for (const [key, value] of Object.entries(mcpConfig)) {
        if (entry.config[key] === void 0) {
          entry.config[key] = value;
          changed = true;
        }
      }
      // Ensure plugin name is correct
      if (entry.name !== "@deepseek-ai/dsh-mcp-client") {
        entry.name = "@deepseek-ai/dsh-mcp-client";
        changed = true;
      }
    }
  }

  if (!changed) return;
  fs.mkdirSync(path.dirname(PATCH), { recursive: true });
  const tmp = `${PATCH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, yaml.dump(entries, { lineWidth: 120, noRefs: true }), { mode: 0o600 });
  fs.renameSync(tmp, PATCH);
}

main().catch(() => {});
