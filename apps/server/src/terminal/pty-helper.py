#!/usr/bin/env python3
"""
PTY helper for Hermes Commander's embedded Hermes TUI.

Spawns a real PTY process and bridges stdin <-> master_fd <-> stdout.
Provides a real controlling terminal (needed by the Hermes TUI: raw mode,
ANSI cursor addressing, resize via SIGWINCH, individual key capture) without
requiring the native `node-pty` addon on the server — the Node backend pipes
bytes over a WebSocket and this helper owns the PTY.

Usage:
    python3 pty-helper.py [cwd] [cols] [rows] -- [command arg1 arg2 ...]

If no command is provided, falls back to an interactive shell.
"""
import sys, os, pty, select, signal, struct, fcntl, termios, stat, io


def set_winsize(fd, rows, cols):
    s = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)


def main():
    default_shell = '/bin/zsh' if sys.platform == 'darwin' else '/bin/bash'

    cwd = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('HOME', '/tmp')
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 24

    command = None
    if '--' in sys.argv[4:]:
        idx = sys.argv.index('--', 4)
        tail = sys.argv[idx + 1:]
        if tail:
            command = tail

    if command is None:
        # No explicit command: drop into an interactive shell (used when the
        # caller wants a plain terminal rather than the Hermes TUI).
        default_shell = '/bin/zsh' if sys.platform == 'darwin' else '/bin/bash'
        command = [os.environ.get('SHELL', default_shell), '-i']

    if not command:
        command = ['/bin/sh']

    if cwd.startswith('~'):
        cwd = os.path.expanduser(cwd)

    # A control pipe (fd 3) is used when the caller opens it (stdio[3]); each
    # line is two integers: "<cols> <rows>". This lets the Node parent send an
    # exact resize without relying on mutable env vars. Guard for absence so it
    # still runs standalone.
    control_fd = 3
    has_control = False
    try:
        if os.fstat(control_fd).st_mode & stat.S_IFMT == stat.S_IFIFO:
            has_control = True
    except Exception:
        has_control = False

    # Create PTY
    master_fd, slave_fd = pty.openpty()
    set_winsize(master_fd, rows, cols)

    pid = os.fork()
    if pid == 0:
        # Child: become session leader, set controlling terminal
        os.setsid()
        os.close(master_fd)
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.chdir(cwd)
        os.environ['TERM'] = 'xterm-256color'
        os.environ['COLORTERM'] = 'truecolor'
        os.execvp(command[0], command)
    else:
        # Parent: bridge stdin <-> master_fd <-> stdout
        os.close(slave_fd)
        import io
        stdin_fd = sys.stdin.fileno()
        stdout_fd = sys.stdout.fileno()
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, write_through=True)

        cols_now = [cols]
        rows_now = [rows]
        control_lines = b''

        def handle_winch(signum, frame):
            # Best-effort: read a resize line from the control pipe if present.
            try:
                if has_control:
                    apply_control_resize()
            except Exception:
                pass

        def apply_control_resize():
            nonlocal control_lines
            try:
                buf = bytearray(control_lines)
                while True:
                    chunk = os.read(control_fd, 256)
                    if not chunk:
                        break
                    buf.extend(chunk)
                decoded = bytes(buf)
                while b'\n' in decoded:
                    line, _, decoded = decoded.partition(b'\n')
                    parts = line.decode().strip().split()
                    if len(parts) >= 2:
                        new_cols = max(1, int(parts[0])); new_rows = max(1, int(parts[1]))
                        set_winsize(master_fd, new_rows, new_cols)
                        os.kill(pid, signal.SIGWINCH)
                control_lines = bytes(decoded)
            except Exception:
                pass

        signal.signal(signal.SIGWINCH, handle_winch)

        try:
            while True:
                fds = [master_fd, stdin_fd]
                if has_control:
                    fds.append(control_fd)
                rlist, _, _ = select.select(fds, [], [], 1.0)
                if master_fd in rlist:
                    try:
                        data = os.read(master_fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    os.write(stdout_fd, data)
                if stdin_fd in rlist:
                    try:
                        data = os.read(stdin_fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    os.write(master_fd, data)
                if has_control and control_fd in rlist:
                    apply_control_resize()
        except (IOError, OSError):
            pass
        finally:
            os.close(master_fd)
            try:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            except Exception:
                pass


if __name__ == '__main__':
    main()
