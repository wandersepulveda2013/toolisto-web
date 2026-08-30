// AI_AUTONOMY/fake-opencode.mjs — A controllable stand-in for the real `opencode`
// binary, used by the CE-068 controlled-process tests to certify that the real
// launcher/supervisor runtime governs execution. No network, no real OpenCode.
//
// Modes (argv[2]):
//   normal   : prints a little narration, makes NO commit, exits 0 with
//              RESULTADO_CICLO marker -> SUCCESS.
//   commit   : makes a REAL git commit (changes a marker file) then prints
//              RESULTADO_CICLO: FEATURE and exits 0 -> verified SUCCESS with
//              HEAD moved (the key "verified progress" signal).
//   loop     : prints "Let me read the QUEUE" repeatedly forever (narration
//              without action) -> supervisor must detect LOOP_INTERRUPTED.
//   crash    : exits immediately with code 1 -> CRASH.
//   frozen   : prints one line then hangs forever -> phase-stall TIMEOUT.
//   slow     : sleeps briefly, prints, exits 0 -> long-running-but-alive.

import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { execFileSync, spawn } from 'child_process';

const mode = process.argv[2] || 'normal';
const marker = process.argv[3] || 'AI_AUTONOMY/.fake-marker.txt';

switch (mode) {
  case 'normal':
    console.log('Inicio: voy a revisar el QUEUE');
    console.log('Implemento una tarea inocua');
    console.log('RESULTADO_CICLO: AUDIT_ONLY');
    process.exit(0);
    break;
  case 'commit': {
    // Real side effect: append + git commit so HEAD moves -> verified progress.
    // Hold briefly after the commit so the live poller reliably observes the new
    // HEAD before the process exits (keeps the CE-069 verified-live assertions
    // deterministic without an aggressive poll).
    appendFileSync(marker, 'x\n');
    execFileSync('git', ['add', marker], { stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fake-opencode test commit'], { stdio: 'ignore' });
    console.log('Implemento y hago commit real');
    console.log('RESULTADO_CICLO: FEATURE');
    const hold = Date.now() + 900;
    while (Date.now() < hold) {}
    process.exit(0);
    break;
  }
  case 'loop':
    // Narration that never turns into an action. Run forever.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      console.log('Let me read the QUEUE');
      const wait = new Date(Date.now() + 150);
      while (Date.now() < wait) {}
    }
    break;
  case 'crash':
    console.log('Voy a empezar...');
    process.exit(1);
    break;
  case 'frozen':
    console.log('Empezando tarea larga (se congela)');
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const wait = new Date(Date.now() + 5000);
      while (Date.now() < wait) {}
    }
    break;
  case 'slow':
    for (let i = 0; i < 3; i++) {
      const wait = new Date(Date.now() + 200);
      while (Date.now() < wait) {}
      console.log('trabajando... paso ' + i);
    }
    console.log('RESULTADO_CICLO: MEANINGFUL_TEST_COVERAGE');
    process.exit(0);
    break;
  case 'silent':
    // CE-069: prints nothing and hangs -> silent STALL (alive, no activity).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const wait = new Date(Date.now() + 2000);
      while (Date.now() < wait) {}
    }
    break;
  case 'legit': {
    // CE-069 §17.C: legitimate long-running work. Makes a REAL git commit
    // (verified progress) after a short delay, then keeps doing bounded work and
    // exits 0 with the marker. The supervisor must NOT false-positive.
    const sleep = (ms) => { const w = Date.now() + ms; while (Date.now() < w) {} };
    sleep(300);
    console.log('Inicio: revisando el QUEUE antes de una tarea larga y legitima');
    sleep(200);
    const marker2 = process.argv[4] || 'AI_AUTONOMY/.fake-marker.txt';
    appendFileSync(marker2, 'legit\n');
    execFileSync('git', ['add', marker2], { stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fake legit long work'], { stdio: 'ignore' });
    console.log('Implemento la tarea larga (commit real hecho)');
    for (let i = 0; i < 3; i++) {
      sleep(250);
      console.log('trabajando en la tarea larga... paso ' + i);
    }
    console.log('RESULTADO_CICLO: FEATURE');
    process.exit(0);
    break;
  }
  case 'tree': {
    // CE-069 §17.G: parent + child + grandchild process tree. The parent spawns a
    // child node that spawns a grandchild node, writes each PID into pidfiles
    // under pidDir (argv[3] || AI_AUTONOMY/.tree-pids), then loops narration
    // forever. The supervisor must interrupt and clean the WHOLE tree (no orphan).
    // Helpers are spawned as real .cjs files taking pidDir at argv[2]
    // (argv[0]=node, argv[1]=script, argv[2]=arg), which is stable regardless of
    // `-e` vs file invocation.
    const pidDir = process.argv[3] || 'AI_AUTONOMY/.tree-pids';
    mkdirSync(pidDir, { recursive: true });
    const pidFile = (name, pid) => writeFileSync(pidDir + '/' + name + '.pid', String(pid));
    writeFileSync(pidDir + '/gc.cjs', [
      "const fs = require('fs');",
      "fs.writeFileSync(process.argv[2] + '/grandchild.pid', String(process.pid));",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    writeFileSync(pidDir + '/c.cjs', [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      "const path = require('path');",
      "fs.writeFileSync(process.argv[2] + '/child.pid', String(process.pid));",
      "spawn(process.execPath, [path.join(__dirname, 'gc.cjs'), process.argv[2]]);",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    // grandchild (directly + via child) and child; chain parent -> child -> grandchild.
    spawn(process.execPath, [pidDir + '/gc.cjs', pidDir]);
    spawn(process.execPath, [pidDir + '/c.cjs', pidDir]);
    pidFile('parent', process.pid);
    // loop narration forever
    // eslint-disable-next-line no-constant-condition
    while (true) {
      console.log('Let me read the QUEUE (tree)');
      const wait = new Date(Date.now() + 150);
      while (Date.now() < wait) {}
    }
    break;
  }
  default:
    console.error('unknown mode: ' + mode);
    process.exit(2);
}
