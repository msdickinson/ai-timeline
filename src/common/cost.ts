/**
 * Cost estimation from token usage.
 *
 * Prices are per million tokens. Numbers below are list price as of early
 * 2026 — they will drift. Each model carries a sourceUrl that links to the
 * canonical pricing page for the provider so users can audit our $/M
 * against the real published rates.
 *
 * Token-counter conventions (matter for cost math):
 *   - Anthropic: `input_tokens`, `cache_read_input_tokens`, and
 *     `cache_creation_input_tokens` are DISJOINT. Don't subtract cache
 *     reads from input — `input_tokens` is already just the fresh portion.
 *   - OpenAI / Gemini: similar structure (cached_input_tokens reported
 *     separately from input_tokens).
 */

interface ModelPricing {
  inputPerM: number;       // $/M fresh input tokens
  outputPerM: number;      // $/M output tokens
  cacheReadPerM?: number;  // $/M cache-read input tokens (Anthropic ~10% of input, OpenAI ~50%)
  cacheWritePerM?: number; // $/M cache-creation input tokens (Anthropic ~125% of input, OpenAI = input)
  sourceUrl?: string;      // canonical pricing page so users can verify our $/M
}

// Source URLs for each provider — canonical pricing pages. Linked from the
// cost-breakdown popover so the user can compare our numbers to the
// authoritative rate sheet at any time.
const ANTHROPIC_PRICING = "https://www.anthropic.com/pricing";
const OPENAI_PRICING = "https://openai.com/api/pricing";
const GOOGLE_PRICING = "https://ai.google.dev/pricing";
const DEEPSEEK_PRICING = "https://api-docs.deepseek.com/quick_start/pricing";

// Prices as of early 2026 — approximate, will drift.
const MODEL_PRICES: Record<string, ModelPricing> = {
  // Anthropic — Opus 4.x family shares input/output rates; cache write ~125% of input.
  "claude-opus-4-7":   { inputPerM: 15,  outputPerM: 75,  cacheReadPerM: 1.5,   cacheWritePerM: 18.75, sourceUrl: ANTHROPIC_PRICING },
  "claude-opus-4-6":   { inputPerM: 15,  outputPerM: 75,  cacheReadPerM: 1.5,   cacheWritePerM: 18.75, sourceUrl: ANTHROPIC_PRICING },
  "claude-sonnet-4-6": { inputPerM: 3,   outputPerM: 15,  cacheReadPerM: 0.3,   cacheWritePerM: 3.75,  sourceUrl: ANTHROPIC_PRICING },
  "claude-haiku-4-5":  { inputPerM: 0.8, outputPerM: 4,   cacheReadPerM: 0.08,  cacheWritePerM: 1.0,   sourceUrl: ANTHROPIC_PRICING },
  // Older Anthropic
  "claude-3-5-sonnet": { inputPerM: 3,   outputPerM: 15,  cacheReadPerM: 0.3,   cacheWritePerM: 3.75,  sourceUrl: ANTHROPIC_PRICING },
  "claude-3-5-haiku":  { inputPerM: 0.8, outputPerM: 4,   cacheReadPerM: 0.08,  cacheWritePerM: 1.0,   sourceUrl: ANTHROPIC_PRICING },
  "claude-3-opus":     { inputPerM: 15,  outputPerM: 75,  cacheReadPerM: 1.5,   cacheWritePerM: 18.75, sourceUrl: ANTHROPIC_PRICING },
  // OpenAI — cache writes billed at the regular input rate
  "gpt-4o":            { inputPerM: 2.5, outputPerM: 10,  cacheReadPerM: 1.25,  sourceUrl: OPENAI_PRICING },
  "gpt-4o-mini":       { inputPerM: 0.15, outputPerM: 0.6, cacheReadPerM: 0.075, sourceUrl: OPENAI_PRICING },
  "gpt-4-turbo":       { inputPerM: 10,  outputPerM: 30,  sourceUrl: OPENAI_PRICING },
  "o1":                { inputPerM: 15,  outputPerM: 60,  cacheReadPerM: 7.5,   sourceUrl: OPENAI_PRICING },
  "o1-mini":           { inputPerM: 3,   outputPerM: 12,  cacheReadPerM: 1.5,   sourceUrl: OPENAI_PRICING },
  // Google
  "gemini-2.0-flash":  { inputPerM: 0.1, outputPerM: 0.4, sourceUrl: GOOGLE_PRICING },
  "gemini-2.0-pro":    { inputPerM: 1.25, outputPerM: 10, sourceUrl: GOOGLE_PRICING },
  // DeepSeek
  "deepseek-chat":     { inputPerM: 0.14, outputPerM: 0.28, cacheReadPerM: 0.014, sourceUrl: DEEPSEEK_PRICING },
  "deepseek-coder":    { inputPerM: 0.14, outputPerM: 0.28, sourceUrl: DEEPSEEK_PRICING },
  // Local (free)
  "local":             { inputPerM: 0, outputPerM: 0 },
};

interface PricingMatch {
  pricing: ModelPricing;
  /** Which key in MODEL_PRICES matched, surfaced to the user. */
  key: string;
  /** How the match was found: "exact" / "fuzzy" / "pattern" / "local-default" */
  source: "exact" | "fuzzy" | "pattern" | "local-default";
}

/** Fuzzy match a model name to a pricing entry, also returning HOW the
 * match was found so the UI can warn when pricing is a guess. */
function findPricingDetailed(model: string): PricingMatch | null {
  const lower = model.toLowerCase();
  // Exact match
  if (MODEL_PRICES[lower]) return { pricing: MODEL_PRICES[lower], key: lower, source: "exact" };
  // Partial match — find the best key that's contained in the model name
  for (const [key, pricing] of Object.entries(MODEL_PRICES)) {
    if (lower.includes(key) || key.includes(lower)) return { pricing, key, source: "fuzzy" };
  }
  // Common patterns
  if (lower.includes("opus"))     return { pricing: MODEL_PRICES["claude-opus-4-7"], key: "claude-opus-4-7", source: "pattern" };
  if (lower.includes("sonnet"))   return { pricing: MODEL_PRICES["claude-sonnet-4-6"], key: "claude-sonnet-4-6", source: "pattern" };
  if (lower.includes("haiku"))    return { pricing: MODEL_PRICES["claude-haiku-4-5"], key: "claude-haiku-4-5", source: "pattern" };
  if (lower.includes("gpt-4o-mini")) return { pricing: MODEL_PRICES["gpt-4o-mini"], key: "gpt-4o-mini", source: "pattern" };
  if (lower.includes("gpt-4o"))   return { pricing: MODEL_PRICES["gpt-4o"], key: "gpt-4o", source: "pattern" };
  if (lower.includes("gemini"))   return { pricing: MODEL_PRICES["gemini-2.0-flash"], key: "gemini-2.0-flash", source: "pattern" };
  if (lower.includes("deepseek")) return { pricing: MODEL_PRICES["deepseek-chat"], key: "deepseek-chat", source: "pattern" };
  // Unknown — local models are free
  if (lower.includes("qwen") || lower.includes("llama") || lower.includes("nemotron") || lower.includes("mistral")) {
    return { pricing: MODEL_PRICES["local"], key: "local", source: "local-default" };
  }
  return null;
}

/** Back-compat shim — call sites that don't care about the source. */
function findPricing(model: string): ModelPricing | null {
  return findPricingDetailed(model)?.pricing ?? null;
}

export interface CostEstimate {
  totalUsd: number;
  perModel: Record<string, number>;
  isEstimate: boolean; // true if any model pricing was guessed
  unknownModels: string[];
  /** Per-model breakdown showing exactly how each total was computed.
   * Surface this in the UI so users can audit the "≈$N" claim and see
   * which pricing entry matched their model. */
  details: CostDetail[];
  /** Date the pricing table was last reviewed. Show this so users know
   * how stale the numbers are when they look at a 6-month-old session. */
  pricesAsOf: string;
}

export interface CostDetail {
  model: string;                 // the original model id from events (e.g. "claude-opus-4-7-20251201")
  pricingKey: string | null;     // which MODEL_PRICES key matched, or null if unknown
  pricingSource: "exact" | "fuzzy" | "pattern" | "local-default" | "unknown";
  /** Canonical pricing page for the matched model, if known. Surfaced in
   * the cost breakdown popover as a clickable link. */
  pricingSourceUrl?: string;
  inputTokens: number;       // FRESH input only (Anthropic input_tokens, etc.)
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  inputCost: number;             // $ for fresh input tokens
  outputCost: number;            // $ for output
  cacheReadCost: number;         // $ for cache-read tokens
  cacheWriteCost: number;        // $ for cache-creation tokens
  totalCost: number;
}

export const PRICES_AS_OF = "2026-01"; // bump when MODEL_PRICES is updated

type EventCostInput = {
  model?: string;
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

/** Estimate cost from token usage across events. Anthropic-style accounting:
 * `tokens.input` is treated as the fresh input count (NOT subtracting cache
 * reads — those are tracked separately by the API). Cache writes carry a
 * premium and are billed independently. */
export function estimateCost(events: EventCostInput[]): CostEstimate {
  const perModel: Record<string, number> = {};
  const unknownModels: string[] = [];
  const details: CostDetail[] = [];
  let isEstimate = false;
  let totalUsd = 0;

  // Aggregate tokens per model first
  const modelTokens = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>();
  for (const ev of events) {
    if (!ev.tokens || !ev.model) continue;
    const model = ev.model;
    const existing = modelTokens.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    existing.input += ev.tokens.input ?? 0;
    existing.output += ev.tokens.output ?? 0;
    existing.cacheRead += ev.tokens.cacheRead ?? 0;
    existing.cacheWrite += ev.tokens.cacheWrite ?? 0;
    modelTokens.set(model, existing);
  }

  for (const [model, tokens] of modelTokens) {
    const match = findPricingDetailed(model);
    if (!match) {
      unknownModels.push(model);
      isEstimate = true;
      details.push({
        model, pricingKey: null, pricingSource: "unknown",
        inputTokens: tokens.input, outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead, cacheWriteTokens: tokens.cacheWrite,
        inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0,
        inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0,
      });
      continue;
    }
    const { pricing, key, source } = match;
    if (pricing.inputPerM === 0 && pricing.outputPerM === 0) {
      perModel[model] = 0; // Local model — free
      details.push({
        model, pricingKey: key, pricingSource: source, pricingSourceUrl: pricing.sourceUrl,
        inputTokens: tokens.input, outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead, cacheWriteTokens: tokens.cacheWrite,
        inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0,
        inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0,
      });
      continue;
    }

    const cacheReadPerM = pricing.cacheReadPerM ?? pricing.inputPerM * 0.1;
    const cacheWritePerM = pricing.cacheWritePerM ?? pricing.inputPerM * 1.25;
    // tokens.input is ALREADY the fresh portion in Anthropic / OpenAI accounting.
    // Don't subtract cache reads — those are tracked in tokens.cacheRead.
    const inputCost = (tokens.input / 1_000_000) * pricing.inputPerM;
    const cacheReadCost = (tokens.cacheRead / 1_000_000) * cacheReadPerM;
    const cacheWriteCost = (tokens.cacheWrite / 1_000_000) * cacheWritePerM;
    const outputCost = (tokens.output / 1_000_000) * pricing.outputPerM;
    const modelCost = inputCost + cacheReadCost + cacheWriteCost + outputCost;

    perModel[model] = modelCost;
    totalUsd += modelCost;
    isEstimate = true; // All costs are estimates since we don't have exact billing
    details.push({
      model, pricingKey: key, pricingSource: source, pricingSourceUrl: pricing.sourceUrl,
      inputTokens: tokens.input, outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead, cacheWriteTokens: tokens.cacheWrite,
      inputPerM: pricing.inputPerM, outputPerM: pricing.outputPerM,
      cacheReadPerM, cacheWritePerM,
      inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost: modelCost,
    });
  }

  return { totalUsd, perModel, isEstimate, unknownModels, details, pricesAsOf: PRICES_AS_OF };
}

/** Format cost as string */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}
