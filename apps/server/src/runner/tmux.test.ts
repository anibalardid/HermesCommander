import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { TmuxSession } from './tmux.js';

// Only run if tmux is available.
const hasTmux = (() => {
  try {
    execFileSync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
})();

const sessions: TmuxSession[] = [];

describe.skipIf(!hasTmux)('TmuxSession', () => {
  it('starts a session, captures output, and kills it', async () => {
    const s = new TmuxSession('test-mission-1');
    sessions.push(s);
    // Use a command that stays alive so the session persists.
    await s.start('echo HELLO_FROM_TMUX; sleep 30');

    await new Promise((r) => setTimeout(r, 500));

    const pane = await s.capture();
    expect(pane).toContain('HELLO_FROM_TMUX');

    await s.kill();
  });

  it('sends a message to the session', async () => {
    const s = new TmuxSession('test-mission-2');
    sessions.push(s);
    // A shell that reads a line and echoes it back, then stays alive.
    await s.start('read x; echo "GOT:$x"; sleep 30');
    await new Promise((r) => setTimeout(r, 300));
    await s.send('hello');
    await new Promise((r) => setTimeout(r, 500));
    const pane = await s.capture();
    expect(pane).toContain('GOT:hello');
    await s.kill();
  });

  it('reports alive while running and dead after the command exits', async () => {
    const s = new TmuxSession('test-mission-3');
    sessions.push(s);
    await s.start('sleep 5');
    expect(await s.isAlive()).toBe(true);
    await s.kill();
    expect(await s.isAlive()).toBe(false);
  });
});

afterAll(async () => {
  for (const s of sessions) {
    await s.kill().catch(() => {});
  }
});
