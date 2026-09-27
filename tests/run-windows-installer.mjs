// Windows CI harness: exercise the same detached helper used by the updater.
import { launchWindowsInstaller } from '../electron/updater.mjs';
const [current, installer, root, pid, hash, scriptPath] = process.argv.slice(2);
console.log('Launching helper', JSON.stringify({ current, installer, root, pid, scriptPath }));
await launchWindowsInstaller(current, installer, root, Number(pid), hash, { scriptPath });
