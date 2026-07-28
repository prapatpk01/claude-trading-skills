// Multi-provider AI gateway.
//
// You can add ANY NUMBER of provider keys (all optional). The app builds a
// fallback chain across every provider you configured, tries FREE tiers first,
// and automatically advances to the next model when one is rate-limited
// (429), out of credit (402), or errors — so analysis keeps working.
//
// Honest note on "pro models used free":
//   • Genuinely free API tiers: Google Gemini, Groq, Cerebras, Mistral.
//   • OpenRouter: only models with the ":free" suffix are free.
//   • Anthropic (Claude) and OpenAI (GPT) have NO free API tier — those keys
//     are pay-per-token and sit at the end of the chain as premium fallbacks.

export type ProviderId =
  | "gemini" | "groq" | "cerebras" | "mistral" | "openrouter" | "anthropic" | "openai";

interface ProviderCfg {
  envKey: string;
  label: string;
  signup: string;
  freeTier: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderCfg> = {
  gemini:     { envKey: "GEMINI_API_KEY",     label: "Google Gemini", signup: "https://aistudio.google.com/apikey",              freeTier: true },
  groq:       { envKey: "GROQ_API_KEY",       label: "Groq",          signup: "https://console.groq.com/keys",                   freeTier: true },
  cerebras:   { envKey: "CEREBRAS_API_KEY",   label: "Cerebras",      signup: "https://cloud.cerebras.ai",                       freeTier: true },
  mistral:    { envKey: "MISTRAL_API_KEY",    label: "Mistral",       signup: "https://console.mistral.ai/api-keys",             freeTier: true },
  openrouter: { envKey: "OPENROUTER_API_KEY", label: "OpenRouter",    signup: "https://openrouter.ai/keys",                      freeTier: true },
  anthropic:  { envKey: "ANTHROPIC_API_KEY",  label: "Anthropic",     signup: "https://console.anthropic.com/settings/keys",     freeTier: false },
  openai:     { envKey: "OPENAI_API_KEY",     label: "OpenAI",        signup: "https://platform.openai.com/api-keys",            freeTier: false },
};

export interface ModelSpec {
  provider: ProviderId;
  model: string;
  label: string;
  tier: "free" | "paid";
}

/** Default chain: free tiers first, premium last. Override with AI_MODELS. */
export const DEFAULT_CHAIN: ModelSpec[] = [
  { provider: "gemini",     model: "gemini-2.5-flash",                    label: "Gemini 2.5 Flash",        tier: "free" },
  { provider: "groq",       model: "llama-3.3-70b-versatile",             label: "Llama 3.3 70B (Groq)",    tier: "free" },
  { provider: "cerebras",   model: "llama-3.3-70b",                       label: "Llama 3.3 70B (Cerebras)",tier: "free" },
  { provider: "mistral",    model: "mistral-large-latest",                label: "Mistral Large",           tier: "free" },
  { provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 (free)",      tier: "free" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", tier: "free" },
  { provider: "gemini",     model: "gemini-2.5-pro",                      label: "Gemini 2.5 Pro",          tier: "free" },
  { provider: "anthropic",  model: "claude-sonnet-5",                     label: "Claude Sonnet 5",         tier: "paid" },
  { provider: "openai",     model: "gpt-4o",                              label: "GPT-4o",                  tier: "paid" },
  { provider: "openrouter", model: "anthropic/claude-3.7-sonnet",         label: "Claude 3.7 Sonnet (OR)",  tier: "paid" },
];

/**
 * Read a provider key.
 *
 * These MUST be static `process.env.NAME` references: Next.js inlines env
 * vars at build time by static analysis, so a computed lookup like
 * `process.env[name]` can resolve to undefined in the bundled output even
 * when the variable is set on the host.
 */
function keyFor(p: ProviderId): string | undefined {
  const raw =
    p === "gemini"     ? process.env.GEMINI_API_KEY :
    p === "groq"       ? process.env.GROQ_API_KEY :
    p === "cerebras"   ? process.env.CEREBRAS_API_KEY :
    p === "mistral"    ? process.env.MISTRAL_API_KEY :
    p === "openrouter" ? process.env.OPENROUTER_API_KEY :
    p === "anthropic"  ? process.env.ANTHROPIC_API_KEY :
    p === "openai"     ? process.env.OPENAI_API_KEY :
    undefined;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Chain filtered to providers that actually have a key configured. */
export function activeChain(): ModelSpec[] {
  const raw = process.env.AI_MODELS?.trim();
  let chain = DEFAULT_CHAIN;
  if (raw) {
    // Format: "provider:model[|Label]" comma-separated
    chain = raw.split(",").map((entry) => {
      const [spec, label] = entry.split("|").map((s) => s.trim());
      const [provider, ...rest] = spec.split(":");
      const model = rest.join(":");
      const p = provider.trim() as ProviderId;
      return {
        provider: p,
        model: model.trim(),
        label: label || model.trim(),
        tier: PROVIDERS[p]?.freeTier ? "free" : "paid",
      } as ModelSpec;
    }).filter((m) => PROVIDERS[m.provider] && m.model);
  }
  return chain.filter((m) => !!keyFor(m.provider));
}

export function configuredProviders(): { id: ProviderId; label: string; freeTier: boolean }[] {
  return (Object.keys(PROVIDERS) as ProviderId[])
    .filter((p) => !!keyFor(p))
    .map((p) => ({ id: p, label: PROVIDERS[p].label, freeTier: PROVIDERS[p].freeTier }));
}

export function aiConfigured(): boolean {
  return activeChain().length > 0;
}

export function setupHint(): string {
  const list = (Object.keys(PROVIDERS) as ProviderId[])
    .filter((p) => PROVIDERS[p].freeTier)
    .map((p) => `${PROVIDERS[p].envKey} (${PROVIDERS[p].signup})`)
    .join(", ");
  return `No AI provider key found. Add at least one of these free-tier keys as an environment variable, then REDEPLOY (env changes only apply to new deployments): ${list}`;
}

/**
 * Which key variables the running server can actually see — booleans only,
 * never values. Lets the UI distinguish "key missing" from "key present but
 * the call failed", which is otherwise impossible to diagnose in production.
 */
export function keyDiagnostics(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of Object.keys(PROVIDERS) as ProviderId[]) {
    out[PROVIDERS[p].envKey] = !!keyFor(p);
  }
  return out;
}

// ── Provider adapters ─────────────────────────────────────────────────

interface CallArgs { key: string; model: string; system: string; user: string; }

/** OpenAI-compatible chat completions (Groq, Cerebras, Mistral, OpenRouter, OpenAI). */
async function callOpenAICompatible(url: string, a: CallArgs, extraHeaders: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${a.key}`, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({
      model: a.model,
      messages: [
        { role: "system", content: a.system },
        { role: "user", content: a.user },
      ],
      temperature: 0.4,
      max_tokens: 900,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function callGemini(a: CallArgs): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent?key=${a.key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: a.system }] },
      contents: [{ role: "user", parts: [{ text: a.user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function callAnthropic(a: CallArgs): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": a.key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: a.model,
      system: a.system,
      messages: [{ role: "user", content: a.user }],
      max_tokens: 1200,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.content?.map((c: any) => c.text ?? "").join("").trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function dispatch(spec: ModelSpec, system: string, user: string): Promise<string> {
  const key = keyFor(spec.provider)!;
  const args: CallArgs = { key, model: spec.model, system, user };
  switch (spec.provider) {
    case "gemini":     return callGemini(args);
    case "anthropic":  return callAnthropic(args);
    case "groq":       return callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", args);
    case "cerebras":   return callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", args);
    case "mistral":    return callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", args);
    case "openai":     return callOpenAICompatible("https://api.openai.com/v1/chat/completions", args);
    case "openrouter": return callOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", args, {
      "HTTP-Referer": process.env.APP_URL || "https://equity-research-terminal.vercel.app",
      "X-Title": "Equity Research Terminal",
    });
  }
}

export interface AiResult {
  text: string;
  model: string;
  modelLabel: string;
  provider: string;
  tier: "free" | "paid";
  tried: string[];
}

export async function runAI(system: string, user: string): Promise<AiResult> {
  const chain = activeChain();
  if (chain.length === 0) throw new Error(setupHint());

  const tried: string[] = [];
  let lastErr = "";
  for (const spec of chain) {
    tried.push(spec.label);
    try {
      const text = await dispatch(spec, system, user);
      return {
        text,
        model: spec.model,
        modelLabel: spec.label,
        provider: PROVIDERS[spec.provider].label,
        tier: spec.tier,
        tried,
      };
    } catch (e: any) {
      // rate-limited / no credit / transient → try the next model in the chain
      lastErr = `${spec.label}: ${e?.message ?? "error"}`;
    }
  }
  throw new Error(`All ${chain.length} configured model(s) failed. Last error — ${lastErr}`);
}
