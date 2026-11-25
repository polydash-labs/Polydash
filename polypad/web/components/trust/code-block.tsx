'use client';

import { CopyButton } from './copy-address';

/** A code block with a copy button. `code` is both the rendered text and the copied text. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative mt-3">
      <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 pr-12 font-mono text-[12px] leading-relaxed text-white/80">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={code} label={label ?? 'Copy code'} />
      </div>
    </div>
  );
}
