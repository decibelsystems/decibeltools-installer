/**
 * Start the Decibel daemon from Claude Desktop, when the user asked for it
 * (tools ISS-0253).
 *
 * Agent HQ talks to a daemon on 127.0.0.1:4888, and HQ's Setup page drives
 * everything after that (pairing, keep-running-at-sign-in, connect) through it.
 * The Desktop extension itself is stdio only, so on a machine with nothing but
 * this bundle there was no daemon for HQ to reach and no way to get one short
 * of a terminal. With "Connect to Agent HQ" ticked, the extension starts one if
 * none is answering.
 *
 * Off by default: nobody gets a background process they did not ask for. The
 * daemon only listens on 127.0.0.1, refuses non-localhost origins, and pairing
 * or control still need an Allow on this screen.
 *
 * Hard rule (as in bootstrap.mjs): nothing here writes to stdout.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

/** The MCPB host passes a boolean user_config as text. */
export function wantsDaemon(env = process.env) {
  const v = String(env.DECIBEL_START_DAEMON ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * The daemon's environment: the extension's, minus what only makes sense for
 * the Desktop stdio server. The facade allowlist would cut the daemon (and so
 * HQ) down to 12 facades, and the project root would pin it to one folder.
 */
export function daemonEnv(env = process.env) {
  const out = { ...env };
  for (const k of ['DECIBEL_FACADES', 'DECIBEL_PROJECT_ROOT', 'DECIBEL_START_DAEMON']) delete out[k];
  return out;
}

async function answering(port, fetchImpl) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start a daemon unless one answers. Never throws; resolves with what it did.
 * The child is detached so it outlives Claude Desktop, and logs to the same
 * files the login service uses.
 */
export async function startDaemonIfWanted(serverPath, deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((m) => process.stderr.write(`[decibel-bootstrap] ${m}\n`));
  if (!wantsDaemon(env)) return 'off';
  const port = Number(env.DECIBEL_DAEMON_PORT) || 4888; // the daemon reads the same variable
  try {
    if (await answering(port, deps.fetch ?? fetch)) return 'running';
    const home = deps.home ?? os.homedir();
    const logs = path.join(home, '.decibel', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const out = fs.openSync(path.join(logs, 'daemon.log'), 'a');
    const err = fs.openSync(path.join(logs, 'daemon-error.log'), 'a');
    const child = (deps.spawn ?? nodeSpawn)(deps.execPath ?? process.execPath, [serverPath, '--daemon', '--port', String(port)], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
      env: daemonEnv(env),
    });
    child.unref?.();
    fs.closeSync(out);
    fs.closeSync(err);
    log(`started the Decibel daemon for Agent HQ on 127.0.0.1:${port} (logs in ${logs})`);
    return 'started';
  } catch (e) {
    log(`could not start the Decibel daemon: ${e?.message ?? e}`);
    return 'error';
  }
}
