import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOGO_MAX_BYTES,
  LOGO_POST_EXPIRES_SECONDS,
  allowedAppHosts,
  clientIp,
  createRateLimiter,
  handleLogoUpload,
  isSameOrigin,
  logoObjectKey,
  logoPostConditions,
} from './logo-upload';

function request(headers: Record<string, string>, body?: unknown) {
  return new Request('https://polypad.family/api/upload/logo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('logo key is server-chosen under token-logos/<id>.<ext> on the public upload prefix', () => {
  assert.equal(
    logoObjectKey('prod/', '11111111-1111-1111-1111-111111111111', 'png'),
    'prod/public/uploads/token-logos/11111111-1111-1111-1111-111111111111.png',
  );
  assert.equal(
    logoObjectKey('', '22222222-2222-2222-2222-222222222222', 'jpg'),
    'public/uploads/token-logos/22222222-2222-2222-2222-222222222222.jpg',
  );
});

test('presigned POST conditions cap size at 5 MB and pin Content-Type', () => {
  assert.equal(LOGO_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(LOGO_POST_EXPIRES_SECONDS, 5 * 60);
  assert.deepEqual(logoPostConditions('image/webp'), [
    ['content-length-range', 1, 5 * 1024 * 1024],
    ['eq', '$Content-Type', 'image/webp'],
  ]);
});

test('same-origin accepts a matching Origin and rejects a foreign one', () => {
  const ok = request({ host: 'polypad.family', origin: 'https://polypad.family' });
  const bad = request({ host: 'polypad.family', origin: 'https://evil.example' });
  const missing = request({ host: 'polypad.family' });
  const opaque = request({ host: 'polypad.family', origin: 'null', referer: 'https://polypad.family/create' });
  assert.equal(isSameOrigin(ok), true);
  assert.equal(isSameOrigin(bad), false);
  assert.equal(isSameOrigin(missing), false);
  assert.equal(isSameOrigin(opaque), false);
});

test('Referer is used only when Origin is absent', () => {
  const viaReferer = request({ host: 'localhost:3000', referer: 'http://localhost:3000/create' });
  const foreignReferer = request({ host: 'localhost:3000', referer: 'https://evil.example/create' });
  const originWins = request({
    host: 'polypad.family',
    origin: 'https://evil.example',
    referer: 'https://polypad.family/create',
  });
  assert.equal(isSameOrigin(viaReferer), true);
  assert.equal(isSameOrigin(foreignReferer), false);
  assert.equal(isSameOrigin(originWins), false);
});

test('NEXTAUTH_URL and x-forwarded-host count as the app host', () => {
  const previous = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'https://polypad.family';
  try {
    const req = request({
      host: 'internal:3000',
      'x-forwarded-host': 'polypad.family',
      origin: 'https://polypad.family',
    });
    assert.equal(allowedAppHosts(req).has('polypad.family'), true);
    assert.equal(allowedAppHosts(req).has('internal:3000'), true);
    assert.equal(isSameOrigin(req), true);
  } finally {
    if (previous === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previous;
  }
});

test('client IP prefers platform headers', () => {
  assert.equal(clientIp(request({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' })), '1.1.1.1');
  assert.equal(clientIp(request({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '9.9.9.9' })), '2.2.2.2');
  assert.equal(clientIp(request({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' })), '3.3.3.3');
  assert.equal(clientIp(request({})), 'unknown');
});

test('rate limiter allows 10 hits per window per key', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter(10, 10 * 60 * 1000, () => now);
  for (let i = 0; i < 10; i++) assert.equal(limiter.allow('1.1.1.1'), true);
  assert.equal(limiter.allow('1.1.1.1'), false);
  assert.equal(limiter.allow('2.2.2.2'), true);
  now += 10 * 60 * 1000;
  assert.equal(limiter.allow('1.1.1.1'), true);
});

test('handler returns a presigned POST and ignores client size', async () => {
  const seen: Array<{ id: string; ext: string; contentType: string }> = [];
  const result = await handleLogoUpload(
    request(
      { host: 'polypad.family', origin: 'https://polypad.family' },
      { contentType: 'image/jpeg', size: 999_999_999 },
    ),
    {
      limiter: { allow: () => true },
      randomId: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      presign: async (input) => {
        seen.push(input);
        return {
          uploadUrl: 'https://bucket.s3.amazonaws.com/',
          fields: { key: 'public/uploads/token-logos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', Policy: 'p' },
          cloud_storage_path: logoObjectKey('', input.id, input.ext),
        };
      },
      publicUrl: async (path) => `https://bucket.example/${path}`,
    },
  );
  assert.equal(result.status, 200);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ext: 'jpg',
    contentType: 'image/jpeg',
  });
  assert.equal(result.body.uploadUrl, 'https://bucket.s3.amazonaws.com/');
  assert.equal(
    result.body.publicUrl,
    'https://bucket.example/public/uploads/token-logos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg',
  );
  assert.equal((result.body.fields as { Policy: string }).Policy, 'p');
});

test('handler rejects foreign origin, bad type, and excess rate', async () => {
  const presign = async () => {
    throw new Error('presign should not run');
  };
  const foreign = await handleLogoUpload(
    request({ host: 'polypad.family', origin: 'https://evil.example' }, { contentType: 'image/png' }),
    { limiter: { allow: () => true }, presign },
  );
  assert.equal(foreign.status, 403);

  const badType = await handleLogoUpload(
    request({ host: 'polypad.family', origin: 'https://polypad.family' }, { contentType: 'image/svg+xml' }),
    { limiter: { allow: () => true }, presign },
  );
  assert.equal(badType.status, 400);

  const shared = createRateLimiter(1, 60_000, () => 0);
  let signed = 0;
  const first = await handleLogoUpload(
    request({ host: 'polypad.family', origin: 'https://polypad.family', 'cf-connecting-ip': '8.8.8.8' }, { contentType: 'image/gif' }),
    {
      limiter: shared,
      presign: async () => {
        signed += 1;
        return { uploadUrl: 'https://example/', fields: { a: 'b' }, cloud_storage_path: 'k' };
      },
      publicUrl: async () => 'https://example/k',
    },
  );
  const second = await handleLogoUpload(
    request({ host: 'polypad.family', origin: 'https://polypad.family', 'cf-connecting-ip': '8.8.8.8' }, { contentType: 'image/gif' }),
    { limiter: shared, presign },
  );
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(signed, 1);
});

test('handler returns 500 when signing fails', async () => {
  const result = await handleLogoUpload(
    request({ host: 'polypad.family', origin: 'https://polypad.family' }, { contentType: 'image/png' }),
    {
      limiter: { allow: () => true },
      presign: async () => {
        throw new Error('no credentials');
      },
    },
  );
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'Could not prepare upload.' });
});
