import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, isAbsolute, resolve, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Store } from '../db/store.js';
import type { EventHub } from '../runner/ws.js';
import { deriveRepoNameFromUrl } from './worktree.js';

const exec = promisify(execFile);

function validateClonePath(url: string, destination: string): string {
  if (!destination || !isAbsolute(destination)) {
    throw new Error('Clone destination must be an absolute path');
  }
  const repoName = deriveRepoNameFromUrl(url);
  const clonePath = join(destination, repoName);
  const rel = relative(resolve(destination), resolve(clonePath));
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Clone path must be inside the destination directory');
  }
  return clonePath;
}

/** Clone a remote repo and register it as a project. */
export async function cloneRepo(store: Store, hub: EventHub, url: string, destination: string) {
  const clonePath = validateClonePath(url, destination);
  mkdirSync(destination, { recursive: true });
  await exec('git', ['clone', '--', url, clonePath], { cwd: destination, timeout: 120_000 });
  const name = deriveRepoNameFromUrl(url);
  const project = store.createProject({
    name, path: clonePath, type: 'git', remote_url: url,
    created_by: 'clone', badge_color: null, parent_group: null,
  });
  hub.emit('office', null, 'project_created', { id: project.id });
  return project;
}
