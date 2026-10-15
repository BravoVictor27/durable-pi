import { test } from "node:test";
import assert from "node:assert/strict";
import { DpiClient } from "../src/client.js";
import { DpiError } from "../src/errors.js";

const doc = {
  exportedAt: "2026-10-15T00:00:00.000Z",
  session: { id: "s1", name: "demo", agents: [] },
  events: [{ agentId: 1, name: "main", entries: [] }],
};

async function withFetch<T>(reply: Response, fn: (calls: { url: string; method?: string }[]) => Promise<T>) {
  const real = globalThis.fetch;
  const calls: { url: string; method?: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    return reply;
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("export() GETs /v1/sessions/:s/export and returns the SessionExport body", async () => {
  await withFetch(Response.json(doc), async (calls) => {
    const out = await new DpiClient("http://dpi.test").session("s 1").export();
    assert.deepEqual(out, doc);
    assert.deepEqual(calls, [{ url: "http://dpi.test/v1/sessions/s%201/export", method: "GET" }]);
  });
});

test("export() throws DpiError not_found for an unknown session", async () => {
  const reply = Response.json({ error: { code: "not_found", message: "no such session" } }, { status: 404 });
  await withFetch(reply, async () => {
    await assert.rejects(
      new DpiClient("http://dpi.test").session("nope").export(),
      (e: unknown) => e instanceof DpiError && e.code === "not_found",
    );
  });
});
