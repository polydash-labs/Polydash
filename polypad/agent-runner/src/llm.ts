/**
 * Optional LLM reasoning hook.
 *
 * If LLM_API_KEY is set, the runner POSTs the decision context to an
 * OpenAI-compatible chat-completions endpoint and uses the reply as the
 * plain-language reasoning for the decision log. The LLM NEVER sets amounts:
 * it only ever returns a short explanation string, and every amount is sized
 * by the rule engine and enforced on-chain by the executor + vault caps.
 * Any LLM failure falls back to the rule-based reasoning.
 *
 * Nothing secret is ever sent: no private key, no signature, no address
 * beyond the fund's public contract addresses.
 */
import type { StrategyDecision } from './strategy.js';

export interface LlmContext {
  templateName: string;
  riskLevel: string;
  decision: StrategyDecision;
  navPerNftEth: string;
  priceEth: number;
  priceChangePct: number | null;
  navDrawdownBps: number;
}

export interface LlmOptions {
  apiKey: string | null;
  apiUrl: string;
  model: string;
  /** Abort the LLM call after this many ms (default 8000). */
  timeoutMs?: number;
}

const MAX_REASONING_CHARS = 280;

export function ruleReasoning(context: LlmContext): string {
  return context.decision.reasoning;
}

/** Ask the LLM for a short plain-language explanation, or fall back to the rule text. */
export async function explainDecision(context: LlmContext, options: LlmOptions): Promise<string> {
  const fallback = ruleReasoning(context);
  if (!options.apiKey) return fallback;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    try {
      const response = await fetch(options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            {
              role: 'system',
              content:
                'You explain fund trading decisions in plain language for everyday investors. ' +
                'One or two short sentences, no jargon, no financial advice, no numbers beyond the ones given. ' +
                'Never suggest an amount or a trade — only explain the decision already made.',
            },
            {
              role: 'user',
              content:
                `Strategy: ${context.templateName} (${context.riskLevel} risk). ` +
                `Decision: ${context.decision.action} (${context.decision.rule}). ` +
                `Rule explanation: ${context.decision.reasoning} ` +
                `Price change over the last day: ${context.priceChangePct === null ? 'unknown' : `${context.priceChangePct.toFixed(2)}%`}. ` +
                `Fund drawdown from its high: ${(context.navDrawdownBps / 100).toFixed(2)}%. ` +
                `Explain this decision in plain language.`,
            },
          ],
          max_tokens: 120,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return fallback;
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) return fallback;
      return text.slice(0, MAX_REASONING_CHARS);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fallback;
  }
}
