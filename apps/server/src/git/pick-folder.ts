import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const exec = promisify(execFile);

/**
 * Open the native folder picker and return the selected path.
 * - macOS: Finder via osascript (choose folder)
 * - Linux: zenity --file-selection --directory
 * Returns null if the user cancels.
 */
export async function pickFolder(): Promise<string | null> {
  const os = platform();
  try {
    if (os === 'darwin') {
      const { stdout } = await exec('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select a project folder")',
      ]);
      return stdout.trim();
    }
    if (os === 'linux') {
      const { stdout } = await exec('zenity', ['--file-selection', '--directory', '--title=Select a project folder']);
      return stdout.trim();
    }
    return null;
  } catch {
    // User cancelled or no picker available.
    return null;
  }
}
