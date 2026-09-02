import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { Store } from '../db/store.js';
import type { EventHub } from '../runner/ws.js';

const exec = promisify(execFile);

/**
 * Create a brand-new project folder, `git init` it, and optionally create a
 * GitHub repo (private or public) and push an initial commit.
 *
 * Returns the registered project.
 */
export async function createNewRepo(
  store: Store,
  hub: EventHub,
  opts: {
    path: string;
    name: string;
    github: 'none' | 'private' | 'public';
    owner?: string | null; // GitHub user or org to create the repo under
  },
) {
  const { path, name, github, owner } = opts;
  if (!isAbsolute(path)) throw new Error('Project path must be an absolute path');

  // Reject unsafe roots (/, home, home parent) before creating anything.
  const { validateProjectPath } = await import('./pathguard.js');
  const guardErr = validateProjectPath(path);
  if (guardErr) throw new Error(guardErr);

  // Create the folder and init git.
  mkdirSync(path, { recursive: true });
  await exec('git', ['init', '-q', '-b', 'main', path], { timeout: 15_000 });

  let remoteUrl: string | null = null;

  if (github !== 'none') {
    // `gh repo create --source --push` fails with "no commits found" if the
    // folder has no commits yet. Make an initial commit (a README) so the
    // push has something to send.
    const readme = `# ${name}\n`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(path, 'README.md'), readme);
    await exec('git', ['add', '-A'], { cwd: path, timeout: 15_000 });
    await exec('git', ['-c', 'user.name=Hermes Commander', '-c', 'user.email=hermes-commander@local', 'commit', '-q', '-m', 'Initial commit'], { cwd: path, timeout: 15_000 });

    // Create the GitHub repo and wire it as the origin remote.
    const visibility = github === 'private' ? '--private' : '--public';
    // `gh repo create` accepts "name" (under the authed user) or "owner/name".
    const repoArg = owner && owner.trim() ? `${owner.trim()}/${name}` : name;
    const { stdout } = await exec(
      'gh',
      ['repo', 'create', repoArg, visibility, '--source', path, '--push'],
      { timeout: 60_000 },
    );
    remoteUrl = stdout.trim() || null;
  }

  const project = store.createProject({
    name,
    path,
    type: 'git',
    remote_url: remoteUrl,
    created_by: 'create',
    badge_color: null,
    parent_group: null,
    setup_script: null,
  });
  hub.emit('office', null, 'project_created', { id: project.id });
  return project;
}
