import { promises as fs } from 'fs';
import { debug } from '../utils/debug.js';
import { findVaultRoot } from '../state/manager.js';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { SYSTEM_DIR, PID_FILE, SOCKET_PATH, getDaemonLogPath, getVaultConfigDir } from '../paths.js';
/**
 * Ensures the system directory exists.
 */
async function ensureDirs() {
    await fs.mkdir(SYSTEM_DIR(), { recursive: true });
    const vaultConfigDir = await getVaultConfigDir();
    await fs.mkdir(vaultConfigDir, { recursive: true });
}
/**
 * Read the PID from the pid file.
 */
export async function readPid() {
    try {
        const content = await fs.readFile(PID_FILE(), 'utf-8');
        const pid = parseInt(content.trim(), 10);
        return isNaN(pid) ? null : pid;
    }
    catch (err) {
        debug('daemon', err);
        return null;
    }
}
/**
 * Write the PID to the pid file.
 */
async function writePid(pid) {
    await ensureDirs();
    await fs.writeFile(PID_FILE(), pid.toString());
}
/**
 * Remove the PID file.
 */
async function removePid() {
    try {
        await fs.unlink(PID_FILE());
    }
    catch (err) {
        debug('daemon', err);
        // Ignore errors
    }
}
/**
 * Check if a process is running by PID.
 */
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        debug('daemon', err);
        return false;
    }
}
/**
 * Get the current daemon status.
 */
export async function getDaemonStatus() {
    const pid = await readPid();
    const running = pid !== null && isProcessRunning(pid);
    // Clean up stale pid file
    if (pid !== null && !running) {
        await removePid();
    }
    return {
        running,
        pid: running ? pid : null,
        socketPath: SOCKET_PATH(),
    };
}
/**
 * Start the daemon process.
 */
export async function startDaemon() {
    const status = await getDaemonStatus();
    if (status.running) {
        return status;
    }
    await ensureDirs();
    // Kill any stale process holding port 3737
    try {
        const pids = execSync('lsof -ti :3737', { encoding: 'utf-8' }).trim();
        if (pids) {
            for (const pid of pids.split('\n')) {
                try {
                    process.kill(parseInt(pid, 10), 'SIGKILL');
                }
                catch {
                    // Process may have already exited
                }
            }
            // Brief wait for port to free up
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    catch {
        // lsof returns non-zero when no process found — that's fine
    }
    // Remove stale socket
    try {
        await fs.unlink(SOCKET_PATH());
    }
    catch (err) {
        debug('daemon', err);
        // Ignore
    }
    // Start the service process.
    // PHAIBEL_SERVICE=1 triggers `service/index.ts` to boot the daemon.
    const entryScript = path.join(import.meta.dirname, '..', 'index.js');
    const logFile = await getDaemonLogPath();
    const logStream = await fs.open(logFile, 'a');
    // Pass the vault root to the child so it can find the vault
    // regardless of its working directory.
    const vaultRoot = await findVaultRoot();
    const childEnv = {
        ...process.env,
        PHAIBEL_SERVICE: '1',
    };
    if (vaultRoot) {
        childEnv.PHAIBEL_VAULT = vaultRoot;
    }
    const child = spawn('node', [entryScript], {
        detached: true,
        stdio: ['ignore', logStream.fd, logStream.fd],
        env: childEnv,
    });
    child.unref();
    if (child.pid) {
        await writePid(child.pid);
    }
    await logStream.close();
    // Wait a moment for service to start
    await new Promise(resolve => setTimeout(resolve, 500));
    return getDaemonStatus();
}
/**
 * Stop the daemon process.
 */
export async function stopDaemon() {
    const status = await getDaemonStatus();
    if (!status.running || status.pid === null) {
        return { running: false, pid: null, socketPath: SOCKET_PATH() };
    }
    try {
        // Send SIGTERM for graceful shutdown
        process.kill(status.pid, 'SIGTERM');
        // Wait for process to exit (max 5 seconds)
        for (let i = 0; i < 50; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!isProcessRunning(status.pid)) {
                break;
            }
        }
        // Force kill if still running
        if (isProcessRunning(status.pid)) {
            process.kill(status.pid, 'SIGKILL');
        }
    }
    catch (err) {
        debug('daemon', err);
        // Process might have already exited
    }
    await removePid();
    // Remove socket
    try {
        await fs.unlink(SOCKET_PATH());
    }
    catch (err) {
        debug('daemon', err);
        // Ignore
    }
    return { running: false, pid: null, socketPath: SOCKET_PATH() };
}
export { SOCKET_PATH, PID_FILE };
