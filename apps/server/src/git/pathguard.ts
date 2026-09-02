import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

/**
 * Validate that a project path is safe to register as a project root.
 * Rejects the filesystem root, the user's home directory, and the platform
 * user-home parent (/Users on macOS, /home on Linux) — registering those as a
 * project would let the file browser / source control operate on the whole
 * machine.
 *
 * Returns an error message, or null when the path is acceptable.
 */
export function validateProjectPath(rawPath: string): string | null {
  const abs = resolve(rawPath);
  const home = homedir();
  const homeParent = resolve(home, '..');

  if (abs === sep) return 'Cannot use the filesystem root (/) as a project path.';
  if (abs === home) return 'Cannot use your home directory as a project path.';
  if (abs === homeParent) return 'Cannot use the user home parent directory as a project path.';

  // Also reject the home directory itself even if it has a trailing slash / is
  // expressed differently (e.g. "~" or "$HOME").
  if (abs === resolve(home)) return 'Cannot use your home directory as a project path.';

  return null;
}
