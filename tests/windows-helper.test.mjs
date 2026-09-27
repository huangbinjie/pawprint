import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { launchWindowsInstaller } from '../electron/updater.mjs';
test('Windows helper starts without a console and reaches its readiness handshake', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pawprint-update-helper-'));
  const scriptPath = path.join(root, 'test-helper.ps1');
  await writeFile(scriptPath, "$ErrorActionPreference='Stop'\n[IO.File]::WriteAllText((Join-Path $env:PAWPRINT_UPDATE_ROOT 'helper.ready'),'ready')\nStart-Sleep -Milliseconds 500\n[IO.File]::WriteAllText((Join-Path $env:PAWPRINT_UPDATE_ROOT 'done'),'done')\n");
  try {
    await launchWindowsInstaller('unused.exe', 'unused.exe', root, process.pid, 'a'.repeat(64), { scriptPath });
    let result;
    for (let i = 0; i < 30; i++) { try { result = await readFile(path.join(root, 'done'), 'utf8'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.equal(result, 'done');
  } catch (error) { let log='';try { log=await readFile(root+'.log','utf8'); } catch {} throw new Error(error.message+'\n'+log); }
});
