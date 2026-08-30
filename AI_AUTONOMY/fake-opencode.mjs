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

import { writeFileSync, appendFileSync } from 'fs';
import { execFileSync } from 'child_process';

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
    appendFileSync(marker, 'x\n');
    execFileSync('git', ['add', marker], { stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fake-opencode test commit'], { stdio: 'ignore' });
    console.log('Implemento y hago commit real');
    console.log('RESULTADO_CICLO: FEATURE');
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
  default:
    console.error('unknown mode: ' + mode);
    process.exit(2);
}
