// Client helpers for uploading collection art and writing metadata through the app's storage API.

export interface TraitRow { name?: string; attributes?: { trait_type: string; value: string | number }[] }

const stem = (n: string) => n.replace(/\.[^.]+$/, '');

export function sortFiles(files: File[]) {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Accepts a JSON array (same order as the sorted images) or an object keyed by image file name without extension. */
export function parseTraits(raw: string, files: File[]): (TraitRow | undefined)[] {
  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    if (data.length !== files.length) throw new Error(`Traits file has ${data.length} entries but you selected ${files.length} images.`);
    return data;
  }
  if (data && typeof data === 'object') return files.map((f) => data[stem(f.name)] ?? data[f.name]);
  throw new Error('Traits file must be a JSON array or object.');
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
  return j;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}

export async function uploadCover(file: File): Promise<string> {
  const draftId = crypto.randomUUID();
  const j = await postJson('/api/nfts/upload', { draftId, files: [{ kind: 'cover', contentType: file.type, size: file.size }] });
  const f = j.files[0];
  const put = await fetch(f.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return f.publicUrl as string;
}

/** Uploads images as 1..N, writes N metadata files, returns the base URI. */
export async function uploadCollectionArt(opts: {
  files: File[];
  traits: (TraitRow | undefined)[];
  collectionName: string;
  description: string;
  onProgress: (done: number, total: number, stage: string) => void;
}): Promise<string> {
  const { files, traits, collectionName, description, onProgress } = opts;
  const draftId = crypto.randomUUID();
  const total = files.length;
  const urls: string[] = new Array(total);
  let done = 0;
  onProgress(0, total, 'Uploading images');
  for (let s = 0; s < total; s += 100) {
    const chunk = files.slice(s, s + 100);
    const j = await postJson('/api/nfts/upload', {
      draftId,
      files: chunk.map((f, k) => ({ kind: 'image', index: s + k + 1, contentType: f.type, size: f.size })),
    });
    await pool(chunk.map((f, k) => ({ f, k })), 6, async ({ f, k }) => {
      const p = j.files[k];
      const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.type }, body: f });
      if (!put.ok) throw new Error(`Upload of ${f.name} failed (${put.status})`);
      urls[s + k] = p.publicUrl;
      onProgress(++done, total, 'Uploading images');
    });
  }
  let baseURI = '';
  onProgress(0, total, 'Writing metadata');
  for (let s = 0; s < total; s += 250) {
    const items = urls.slice(s, s + 250).map((image, k) => ({
      index: s + k + 1,
      image,
      name: traits[s + k]?.name,
      attributes: traits[s + k]?.attributes,
    }));
    const j = await postJson('/api/nfts/metadata', { draftId, collectionName, description, items });
    baseURI = j.baseURI;
    onProgress(Math.min(total, s + 250), total, 'Writing metadata');
  }
  return baseURI;
}
