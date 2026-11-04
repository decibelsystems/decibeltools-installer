/**
 * "Connect to Agent HQ" (tools ISS-0253): the extension starts the daemon only
 * when asked, only when none is answering, and never hands it the Desktop
 * server's facade allowlist or project pin. spawn and fetch are faked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wantsDaemon, daemonEnv, startDaemonIfWanted } from '../server/daemonStart.mjs';

const MANIFEST = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('off by default, and only a true value turns it on', () => {
  assert.equal(MANIFEST.user_config.connect_hq.default, false);
  assert.equal(MANIFEST.server.mcp_config.env.DECIBEL_START_DAEMON, '${user_config.connect_hq}');
  for (const v of [undefined, '', 'false', '0', '${user_config.connect_hq}']) assert.equal(wantsDaemon({ DECIBEL_START_DAEMON: v }), false, String(v));
  for (const v of ['true', 'TRUE', '1']) assert.equal(wantsDaemon({ DECIBEL_START_DAEMON: v }), true, v);
});

test('the Desktop tools include chat', () => {
  assert.ok(MANIFEST.server.mcp_config.env.DECIBEL_FACADES.split(',').includes('chat'));
});

test('the daemon does not inherit the Desktop allowlist or project pin', () => {
  const env = daemonEnv({ DECIBEL_FACADES: 'sentinel', DECIBEL_PROJECT_ROOT: '/p', DECIBEL_START_DAEMON: 'true', NODE_ENV: 'production', DECIBEL_LICENSE_KEY: 'k' });
  assert.deepEqual(env, { NODE_ENV: 'production', DECIBEL_LICENSE_KEY: 'k' });
});

function fakes({ up }) {
  const spawned = [];
  return {
    spawned,
    deps: {
      env: { DECIBEL_START_DAEMON: 'true', DECIBEL_FACADES: 'sentinel', NODE_ENV: 'production' },
      home: fs.mkdtempSync(path.join(os.tmpdir(), 'dcb-daemonstart-')),
      execPath: '/usr/bin/node',
      log: () => {},
      fetch: async () => {
        if (!up) throw new Error('ECONNREFUSED');
        return { ok: true };
      },
      spawn: (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return { unref() {} };
      },
    },
  };
}

test('starts a detached, windowless daemon when none answers', async () => {
  const f = fakes({ up: false });
  assert.equal(await startDaemonIfWanted('/x/server.js', f.deps), 'started');
  assert.equal(f.spawned.length, 1);
  const s = f.spawned[0];
  assert.deepEqual(s.args, ['/x/server.js', '--daemon', '--port', '4888']);
  assert.equal(s.opts.detached, true);
  assert.equal(s.opts.windowsHide, true);
  assert.equal(s.opts.env.DECIBEL_FACADES, undefined);
  assert.ok(fs.existsSync(path.join(f.deps.home, '.decibel', 'logs', 'daemon.log')));
});

test('leaves a running daemon alone, and does nothing when off', async () => {
  const running = fakes({ up: true });
  assert.equal(await startDaemonIfWanted('/x/server.js', running.deps), 'running');
  assert.equal(running.spawned.length, 0);
  const off = fakes({ up: false });
  off.deps.env = {};
  assert.equal(await startDaemonIfWanted('/x/server.js', off.deps), 'off');
  assert.equal(off.spawned.length, 0);
});

test('a failed start never throws', async () => {
  const f = fakes({ up: false });
  f.deps.spawn = () => { throw new Error('EACCES'); };
  assert.equal(await startDaemonIfWanted('/x/server.js', f.deps), 'error');
});
