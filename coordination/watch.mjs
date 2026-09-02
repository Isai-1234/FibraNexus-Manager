#!/usr/bin/env node
/**
 * Poll ORDER.md cada N segundos + fs.watch.
 * Emite AGENT_LOOP_WAKE_COORDINATION si hay orden pending y no hay .lock
 *
 * Uso: node coordination/watch.mjs [intervalSec]
 * Default interval: 5s
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDER = path.join(__dirname, 'ORDER.md');
const TRIGGER = path.join(__dirname, 'TRIGGER.md');
const LOCK = path.join(__dirname, '.lock');
const STATE = path.join(__dirname, 'state.json');
const LOG = path.join(__dirname, 'watch.log');

const INTERVAL_SEC = Math.max(5, parseInt(process.argv[2] || '5', 10));

const WAKE_PROMPT =
  'Revisa coordination/ORDER.md. Si status es pending y no hay .lock, ejecuta la orden, escribe coordination/REPORT.md Y coordination/reports/NNN-report.md (historial), marca ORDER done, borra .lock. Sin pedir confirmación.';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return { lastNotifiedId: null, lastNotifiedAt: null };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

function parseOrder(content) {
  const statusPending =
    /## STATUS:\s*pending/i.test(content) || /\bstatus:\s*pending\b/i.test(content);
  const idMatch =
    content.match(/\*\*id:\*\*\s*(\S+)/i) ||
    content.match(/^id:\s*"?(\d+)"?/im) ||
    content.match(/ORDEN\s+(\d+)/i);
  const id = idMatch ? idMatch[1].replace(/[^\d]/g, '') : null;
  return { pending: statusPending, id };
}

function writeTrigger(reason, orderId) {
  fs.writeFileSync(
    TRIGGER,
    `# TRIGGER\n\n\`\`\`yaml\nat: ${new Date().toISOString()}\nreason: ${reason}\norder_id: ${orderId || 'unknown'}\naction: auto-timer\n\`\`\`\n`,
  );
}

function wakeAgent(reason, orderId) {
  writeTrigger(reason, orderId);
  console.log(
    `AGENT_LOOP_WAKE_COORDINATION ${JSON.stringify({ prompt: WAKE_PROMPT, reason, orderId })}`,
  );
}

function checkOrder(reason) {
  try {
    if (fs.existsSync(LOCK)) {
      log(`Skip (${reason}): .lock presente — agente procesando`);
      return;
    }

    const content = fs.readFileSync(ORDER, 'utf8');
    const { pending, id } = parseOrder(content);

    if (!pending) {
      if (readState().lastNotifiedId) writeState({ lastNotifiedId: null, lastNotifiedAt: null });
      log(`OK (${reason}): sin orden pending`);
      return;
    }

    const state = readState();
    if (state.lastNotifiedId === id && (reason === 'poll' || reason.startsWith('poll:'))) {
      log(`Skip poll: orden ${id} ya notificada, esperando agente`);
      return;
    }

    log(`Orden PENDING ${id} (${reason}) → despertando agente`);
    writeState({ lastNotifiedId: id, lastNotifiedAt: new Date().toISOString() });
    wakeAgent(reason, id);
  } catch (err) {
    log(`Error (${reason}): ${err.message}`);
  }
}

log(`Watcher timer ${INTERVAL_SEC}s — ORDER.md + poll`);
checkOrder('startup');

let debounce;
fs.watch(ORDER, (event) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => checkOrder(`fs:${event}`), 300);
});

setInterval(() => checkOrder('poll'), INTERVAL_SEC * 1000);

process.on('SIGINT', () => {
  log('Watcher detenido');
  process.exit(0);
});
