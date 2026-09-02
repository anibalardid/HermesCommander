import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * tmux-based PTY layer for interactive agent control.
 *
 * Each mission gets its own tmux session so the user can redirect/message the
 * agent mid-work (the `interrupt` path). tmux gives us a real PTY, which
 * prompt_toolkit (Hermes CLI) requires. See docs/03-mission-runtime.md.
 */
export class TmuxSession {
  private name: string;

  constructor(missionId: string) {
    // tmux session names must be alphanumeric + dashes.
    this.name = `hermes-commander-${missionId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  }

  /** Start a new detached tmux session running the given command in a cwd. */
  async start(command: string, cwd?: string): Promise<void> {
    const args = ['new-session', '-d', '-s', this.name, '-x', '200', '-y', '50'];
    if (cwd) args.push('-c', cwd);
    args.push(command);
    await exec('tmux', args);
  }

  /** Send a message to the agent (redirect / interrupt). */
  async send(message: string): Promise<void> {
    await exec('tmux', ['send-keys', '-t', this.name, message, 'Enter']);
  }

  /** Capture the current pane content (for logs/telemetry). */
  async capture(): Promise<string> {
    try {
      const { stdout } = await exec('tmux', ['capture-pane', '-t', this.name, '-p']);
      return stdout;
    } catch {
      return '';
    }
  }

  /** Whether the tmux session still exists (i.e. the command hasn't exited). */
  async isAlive(): Promise<boolean> {
    try {
      await exec('tmux', ['has-session', '-t', this.name]);
      return true;
    } catch {
      return false;
    }
  }

  /** Pause the session (SIGSTOP the pane process). */
  async pause(): Promise<void> {
    await exec('tmux', ['send-keys', '-t', this.name, 'C-z']);
  }

  /** Kill the session. */
  async kill(): Promise<void> {
    try {
      await exec('tmux', ['kill-session', '-t', this.name]);
    } catch {
      // Session may already be gone.
    }
  }

  get sessionName(): string {
    return this.name;
  }
}
