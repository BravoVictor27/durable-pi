import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/commands.ts";
import type { App } from "../src/app.ts";

const doc = {
  exportedAt: "2026-10-15T00:00:00.000Z",
  session: { id: "s1", name: "My Demo", agents: [] },
  events: [{ agentId: 1, name: "main", entries: [] }],
};

function fakeApp(open = true, name = doc.session.name) {
  const flashes: { text: string; error: boolean }[] = [];
  const asked: string[] = [];
  const summary = { ...doc.session, name };
  const app = {
    sessionId: open ? "s1" : undefined,
    client: {
      session: (id: string) => ({
        export: async () => {
          asked.push(id);
          return doc;
        },
      }),
    },
    sessionSummary: () => (open ? summary : undefined),
    flash: (text: string, error = false) => void flashes.push({ text, error }),
    run: async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        app.flash((e as Error).message, true);
      }
    },
  };
  return { app: app as unknown as App, flashes, asked };
}

async function inTempDir(fn: (dir: string) => Promise<void>) {
  const prev = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "dpi-save-"));
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(prev);
  }
}

test("/save <path> writes the session export as JSON", async () => {
  await inTempDir(async (dir) => {
    const { app, flashes, asked } = fakeApp();
    assert.equal(await runCommand(app, "/save out.json"), true);
    assert.deepEqual(asked, ["s1"], "exports the open session's id");
    const text = readFileSync(join(dir, "out.json"), "utf8");
    assert.deepEqual(JSON.parse(text), doc);
    assert.match(text, /\n {2}"exportedAt"/, "indented");
    assert.equal(flashes.at(-1)?.error, false);
  });
});

test("/save refuses to overwrite an existing file", async () => {
  await inTempDir(async (dir) => {
    writeFileSync(join(dir, "out.json"), "keep me");
    const { app, flashes } = fakeApp();
    await runCommand(app, "/save out.json");
    assert.equal(readFileSync(join(dir, "out.json"), "utf8"), "keep me");
    assert.equal(flashes.at(-1)?.error, true);
    assert.match(flashes.at(-1)!.text, /already exists; nothing written/);
    assert.deepEqual(readdirSync(dir), ["out.json"]);
  });
});

test("/save with no path writes <session-name>-<timestamp>.json in the working directory", async () => {
  await inTempDir(async (dir) => {
    const { app } = fakeApp();
    await runCommand(app, "/save");
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^My-Demo-\d{4}-\d{2}-\d{2}T[\d-]+Z?\.json$/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, files[0]), "utf8")), doc);
  });
});

test("/save default name keeps non-ASCII session names and strips path separators", async () => {
  await inTempDir(async (dir) => {
    for (const name of ["Café", "会话", "a/b\\c:d"]) {
      const { app } = fakeApp(true, name);
      await runCommand(app, "/save");
    }
    const files = readdirSync(dir).sort();
    assert.equal(files.length, 3);
    assert.ok(files.some((f) => f.startsWith("Café-")), "Café kept");
    assert.ok(files.some((f) => f.startsWith("会话-")), "会话 kept");
    assert.ok(files.some((f) => f.startsWith("a-b-c-d-")), "separators stripped");
  });
});

test("/save default name falls back to the session id when the name leaves nothing", async () => {
  await inTempDir(async (dir) => {
    const { app } = fakeApp(true, "///");
    await runCommand(app, "/save");
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^s1-\d{4}-/);
  });
});

test("/save with no session open flashes an error and writes nothing", async () => {
  await inTempDir(async (dir) => {
    const { app, flashes } = fakeApp(false);
    await runCommand(app, "/save out.json");
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(flashes.at(-1)?.error, true);
  });
});
