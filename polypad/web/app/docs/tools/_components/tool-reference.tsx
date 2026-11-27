'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type ToolInput = {
  field: string;
  type: string;
  required: boolean;
  description: string;
  enum?: unknown[];
};

type ToolError = { code: string; status: number; meaning: string };

type Tool = {
  name: string;
  title: string;
  description: string;
  group: string;
  /** 'read' or 'prepare' — kept as string because the JSON is generated, not hand-typed. */
  kind: string;
  method: string;
  path: string;
  inputs: ToolInput[];
  exampleArgs: Record<string, unknown>;
  exampleCurl: string;
  exampleMcp: string;
  errors: ToolError[];
};

const GROUP_ORDER = ['Read', 'Trade', 'Launch', 'Tokenized Funds', 'NFTs'];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the text is selectable in the block below.
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-mono text-[13px] text-[#00E676]">{tool.name}</h3>
        {tool.kind === 'prepare' ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
            Prepare — needs a signature + ETH
          </span>
        ) : (
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/60">
            Read — no signature needed
          </span>
        )}
      </div>
      <p className="mt-2 text-[14px] font-medium text-white">{tool.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-white/65">{tool.description}</p>
      {tool.kind === 'prepare' && (
        <p className="mt-2 text-[12px] leading-relaxed text-amber-200/80">
          Replace 0x1111…1111 in the examples below with your own funded wallet address — the placeholder will fail.
        </p>
      )}
      <p className="mt-3 font-mono text-[12px] text-white/70">
        {tool.method} <span className="text-white/50">/api/agents/v2/{tool.path}</span>
      </p>

      {tool.inputs.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-medium text-white">Inputs</p>
          <div className="mt-2 space-y-2">
            {tool.inputs.map((input) => (
              <div key={input.field} className="text-[13px] leading-relaxed">
                <span className="font-mono text-[12px] text-white">{input.field}</span>{' '}
                <span className="text-white/45">
                  {input.type}
                  {input.required ? ' · required' : ' · optional'}
                  {input.enum ? ` · one of: ${input.enum.join(', ')}` : ''}
                </span>
                <span className="block text-white/60">{input.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-white">Example — REST</p>
          <CopyButton text={tool.exampleCurl} />
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{tool.exampleCurl}</pre>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-white">Example — MCP</p>
          <CopyButton text={tool.exampleMcp} />
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{tool.exampleMcp}</pre>
      </div>

      <div className="mt-4">
        <p className="text-[13px] font-medium text-white">What can go wrong</p>
        <ul className="mt-2 space-y-1.5">
          {tool.errors.map((e) => (
            <li key={e.code} className="text-[13px] leading-relaxed text-white/60">
              <span className="font-mono text-[12px] text-white">{e.code}</span>{' '}
              <span className="text-white/45">({e.status})</span> — {e.meaning}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function ToolReference({ tools }: { tools: Tool[] }) {
  return (
    <div className="space-y-10">
      {GROUP_ORDER.map((group) => {
        const groupTools = tools.filter((t) => t.group === group);
        if (groupTools.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="text-base font-semibold">{group}</h2>
            <div className="mt-4 space-y-4">
              {groupTools.map((t) => (
                <ToolCard key={t.name} tool={t} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
