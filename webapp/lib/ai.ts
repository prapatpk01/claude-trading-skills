// Multi-model AI gateway via OpenRouter.
// One API key → access to many models (free + pro). We try models in order
// and automatically fall back to the next when one is rate-limited, out of
// credit, or errors — so analysis keeps working continuously.
//
// Configure the chain with AI_MODELS (comma-separated OpenRouter model IDs).
// Free models (":free") are tried first to stay at zero cost; stronger paid
// models act as fallbacks. Get a key at https://openrouter.ai/keys

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Curated default chain: free/keyless-tier first → premium fallbacks.
export const DEFAULT_MODELS = [
  "deepseek/deepseek-chat-v3-0324:free", // strong free general model
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "anthropic/claude-3.7-sonnet", // premium fallbacks (consume OpenRouter credit)
  "openai/gpt-4o",
  "google/gemini-pro-1.5",
];

export function configuredModels(): string[] {
  const raw = process.env.AI_MODELS;
  if (raw && raw.trim()) return raw.split(",").map((m) => m.trim()).filter(Boolean);
  return DEFAULT_MODELS;
}

export function aiConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

const prettyName = (id: string) =>
  id
    .replace(":free", " (free)")
    .replace("anthropic/claude", "Claude")
    .replace("openai/", "")
    .replace("google/", "")
    .replace("meta-llama/", "")
    .replace("deepseek/", "DeepSeek ")
    .replace("qwen/", "Qwen ")
    .replace("mistralai/", "Mistral ")
    .replace(/-/g, " ");

export interface AiResult {
  text: string;
  model: string;
  modelLabel: string;
  tried: string[];
}

export async function runAI(system: string, user: string): Promise<AiResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("AI is not configured. Add OPENROUTER_API_KEY to enable AI analysis (free key at openrouter.ai/keys).");

  const models = configuredModels();
  const tried: string[] = [];
  let lastErr = "";

  for (const model of models) {
    tried.push(model);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "https://equity-research-terminal.vercel.app",
          "X-Title": "Equity Research Terminal",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.4,
          max_tokens: 900,
        }),
      });

      if (!res.ok) {
        // 429 rate-limit / 402 out-of-credit / 5xx → fall through to next model
        lastErr = `${model}: HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) {
        lastErr = `${model}: empty response`;
        continue;
      }
      return { text, model, modelLabel: prettyName(model), tried };
    } catch (e: any) {
      lastErr = `${model}: ${e?.message ?? "error"}`;
    }
  }
  throw new Error(`All AI models failed. Last error: ${lastErr}`);
}
