/**
 * The largest request body each POST path takes (SEC-5): server functions carry small JSON, the composition upload one
 * artwork of up to 4 MB, the demo upload an image and its smaller copies. A declared Content-Length over the limit is
 * refused before anything reads it. A body without one (chunked) is read only up to the limit, then handed on as bytes,
 * so no request can make the Worker buffer more than its path allows.
 */
const BODY_LIMITS: [RegExp, number][] = [
  [/^\/_serverFn\//, 64 * 1024],
  [/^\/api\/live\/compose$/, 5 * 1024 * 1024],
  [/^\/api\/upload$/, 6 * 1024 * 1024],
];
const DEFAULT_BODY_LIMIT = 1024 * 1024;
const tooLarge = () => new Response(JSON.stringify({ ok: false, error: "That request is too large." }), {
  status: 413, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
export async function limitRequestBody(request: Request, url: URL): Promise<Request | Response> {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) return request;
  const limit = BODY_LIMITS.find(([path]) => path.test(url.pathname))?.[1] ?? DEFAULT_BODY_LIMIT;
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= limit) return request;
    // Not read: the body is released, so the connection can carry the refusal at once.
    await request.body.cancel().catch(() => undefined);
    return tooLarge();
  }
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => undefined); return tooLarge(); }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request, { body });
}
