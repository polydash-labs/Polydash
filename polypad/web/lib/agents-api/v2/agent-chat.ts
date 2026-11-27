/**
 * Business agent chat — the Polypad AI-infra tool.
 *
 * A business (today: Major League Operator) sends a system prompt and chat
 * messages; Polypad runs the completion and returns the reply. The caller
 * never sees the OpenAI key, the model is fixed (gpt-4o-mini — never switched
 * to keep going), and a 429 from OpenAI is passed through as `quota`, never
 * retried.
 *
 * Privacy: prompts can carry a business's own user data — for MLO that means
 * youth players' names, teams, and stats. Nothing about the prompt or the
 * reply is ever logged, and the usage row records only the tool name, kind,
 * and status. The key itself is server-only: it is sent as a Bearer header
 * to api.openai.com and never returned, logged, or stored anywhere else.
 */
import { ApiError } from './core';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const FETCH_TIMEOUT_MS = 30_000;

type Json = Record<string, unknown>;

function asMessages(input: Json): { role: 'user' | 'assistant'; content: string }[] {
  const raw = Array.isArray(input.messages) ? input.messages : [];
  if (raw.length < 1 || raw.length > 20) {
    throw new ApiError(400, 'invalid_params', 'messages must have 1 to 20 entries.', { field: 'messages' });
  }
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') {
      throw new ApiError(400, 'invalid_params', 'Each message needs role and content.', { field: 'messages' });
    }
    const rec = m as Record<string, unknown>;
    // 12,000 per message: MLO's grounded user message (full player context +
    // the question) already runs ~4,100 chars, and richer player data grows it.
    if ((rec.role !== 'user' && rec.role !== 'assistant') || typeof rec.content !== 'string' || rec.content.length < 1 || rec.content.length > 12000) {
      throw new ApiError(400, 'invalid_params', 'Each message needs role user|assistant and content of 1 to 12000 characters.', { field: 'messages' });
    }
    out.push({ role: rec.role, content: rec.content });
  }
  return out;
}

export async function agentChat(input: Json): Promise<Json> {
  const systemPrompt = typeof input.systemPrompt === 'string' ? input.systemPrompt : '';
  if (systemPrompt.length < 1 || systemPrompt.length > 12000) {
    throw new ApiError(400, 'invalid_params', 'systemPrompt is required (1 to 12000 characters).', { field: 'systemPrompt' });
  }
  const messages = asMessages(input);
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? Math.min(1, Math.max(0, input.temperature))
      : 0.7;
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)
      ? Math.min(2000, Math.max(1, Math.floor(input.maxTokens)))
      : 600;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Status-only log: never the key, never the prompt, never the reply.
    console.warn('[agent-chat] OPENAI_API_KEY not configured');
    throw new ApiError(503, 'agent_chat_unavailable', 'Agent chat is not configured yet.');
  }

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn('[agent-chat] fetch failed', e instanceof Error ? e.name : 'unknown');
    throw new ApiError(503, 'agent_chat_unavailable', 'The chat service did not answer.');
  }
  if (res.status === 429) {
    console.warn('[agent-chat] openai 429');
    throw new ApiError(429, 'quota', 'The chat service is out of credits. Try again later.', { retryAfter: 60 });
  }
  if (!res.ok) {
    console.warn('[agent-chat] openai non-ok', res.status);
    throw new ApiError(503, 'agent_chat_unavailable', 'The chat service did not answer.');
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  } | null;
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new ApiError(503, 'agent_chat_unavailable', 'The chat service returned no reply.');
  return {
    ok: true,
    reply,
    model: MODEL,
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
      totalTokens: data?.usage?.total_tokens ?? null,
    },
  };
}
