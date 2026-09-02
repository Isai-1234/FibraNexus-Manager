#!/usr/bin/env node
/**
 * Runner autónomo — ejecuta órdenes de Claude SIN agente Cursor.
 * Poll ORDER.md cada 5s → SSH bash blocks → REPORT.md + reports/NNN-report.md
 *
 * Uso: node coordination/runner.mjs [intervalSec]
 * Windows: node coordination/runner.mjs
 */
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDER = path.join(__dirname, 'ORDER.md');
const REPORT = path.join(__dirname, 'REPORT.md');
const REPORTS_DIR = path.join(__dirname, 'reports');
const LOCK = path.join(__dirname, '.lock');
const STATE = path.join(__dirname, 'state.json');
const LOG = path.join(__dirname, 'runner.log');
const INBOX = path.join(__dirname, 'INBOX.md');

const INTERVAL_SEC = Math.max(5, parseInt(process.argv[2] || '5', 10));
const VPS = 'root@134.209.43.175';
const SSH_KEY = process.env.COORD_SSH_KEY || path.join(process.env.USERPROFILE || process.env.HOME, '.ssh', 'id_ed25519');
const NVM_PATH = 'export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return { lastProcessedId: null };
  }
}

function writeState(s) {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}

function parseOrder(content) {
  const pending =
    /## STATUS:\s*pending/i.test(content) || /\bstatus:\s*pending\b/i.test(content);
  const idMatch =
    content.match(/\*\*id:\*\*\s*(\S+)/i) ||
    content.match(/ORDEN\s+(\d+)/i);
  const id = idMatch ? idMatch[1].replace(/[^\d]/g, '') : '?';
  const bashBlocks = [...content.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  return { pending, id, bashBlocks, raw: content };
}

function sshRun(script) {
  const full = `${NVM_PATH}\n${script}`;
  const b64 = Buffer.from(full, 'utf8').toString('base64');
  const keyArg = fs.existsSync(SSH_KEY) ? `-i "${SSH_KEY}"` : '';
  try {
    const out = execSync(
      `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 ${keyArg} ${VPS} "echo ${b64} | base64 -d | bash"`,
      { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, shell: true },
    );
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, output: (err.stdout || '') + (err.stderr || '') + (err.message || '') };
  }
}

/** Convierte comentarios "# Cambiar X por Y" en sed cuando el bloque bash es solo comentarios */
function preprocessBashBlock(text) {
  let t = text
    .replace(/\bpm2 logs ([^\n|]+)(?!.*--nostream)/g, 'pm2 logs $1 --nostream')
    .replace(/^#.*$/gm, '')
    .trim();
  if (/PROCESS_ROLE=all/.test(text) && /PROCESS_ROLE=api/.test(text)) {
    t = `sed -i 's/^PROCESS_ROLE=.*/PROCESS_ROLE=api/' /root/app/server/.env; sed -i 's/^PROCESS_ROLE=.*/PROCESS_ROLE=api/' /root/app/.env; cat /root/app/server/.env | grep PROCESS_ROLE\n${t}`;
  }
  return t.replace(/\n/g, '\n');
}

function writeReport(id, body, status) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const hist = path.join(REPORTS_DIR, `${id.padStart(3, '0')}-report.md`);
  fs.writeFileSync(hist, body);
  fs.writeFileSync(REPORT, `# REPORT.md — Último reporte\n\n> Historial: [\`reports/${id.padStart(3, '0')}-report.md\`](./reports/${id.padStart(3, '0')}-report.md)\n\n${body}`);
  fs.writeFileSync(
    INBOX,
    `# INBOX — Para Claude PC\n\n\`\`\`yaml\nupdated: ${new Date().toISOString()}\norder_id: "${id}"\nstatus: ${status}\n\`\`\`\n\nLee \`coordination/REPORT.md\`.\n`,
  );
}

function markOrderDone(id, status) {
  let content = fs.readFileSync(ORDER, 'utf8');
  const st = status === 'completed' ? 'done' : 'failed';
  content = content.replace(/## STATUS:\s*pending/gi, `## STATUS: ${st}`);
  content = content.replace(/\*\*status:\*\*\s*pending/gi, `**status:** ${st}`);
  content += `\n\n---\n**completed_by:** runner.mjs\n**completed_at:** ${new Date().toISOString()}\n**result:** ${status}\n`;
  fs.writeFileSync(ORDER, content);
}

async function executeOrder(order) {
  const { id, bashBlocks } = order;
  log(`Ejecutando ORDEN ${id} (${bashBlocks.length} bloques bash)`);
  fs.writeFileSync(LOCK, `order_id=${id}\nstarted=${new Date().toISOString()}\nby=runner.mjs\n`);

  const results = [];
  for (let i = 0; i < bashBlocks.length; i++) {
    log(`  bloque ${i + 1}/${bashBlocks.length}`);
    const r = sshRun(preprocessBashBlock(bashBlocks[i]));
    results.push({ block: i + 1, ok: r.ok, output: r.output.slice(-8000) });
  }

  const allOk = results.every((r) => r.ok);
  const reportBody = `# ORDEN ${id} — Reporte (runner autónomo)

\`\`\`yaml
order_id: "${id}"
status: ${allOk ? 'completed' : 'failed'}
by: runner.mjs
executed_at: ${new Date().toISOString()}
\`\`\`

## Bloques ejecutados

${results.map((r) => `### Bloque ${r.block} — ${r.ok ? 'OK' : 'FAIL'}\n\`\`\`\n${r.output}\n\`\`\``).join('\n\n')}

## Nota

Runner ejecuta bloques \`\`\`bash\`\`\` vía SSH. Ediciones de código complejas requieren agente Cursor o PASO explícito con sed/scp.
`;

  const status = allOk ? 'completed' : 'failed';
  writeReport(id, reportBody, status);
  markOrderDone(id, status);
  writeState({ lastProcessedId: id, lastProcessedAt: new Date().toISOString() });
  fs.unlinkSync(LOCK);
  log(`ORDEN ${id} ${status} → REPORT + INBOX.md`);
}

function tick(reason) {
  try {
    if (fs.existsSync(LOCK)) return;
    const content = fs.readFileSync(ORDER, 'utf8');
    const order = parseOrder(content);
    if (!order.pending) return;

    const state = readState();
    if (state.lastProcessedId === order.id && reason === 'poll') return;

    executeOrder(order).catch((err) => {
      log(`ERROR orden ${order.id}: ${err.message}`);
      if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
    });
  } catch (err) {
    log(`tick error: ${err.message}`);
  }
}

log(`Runner autónomo cada ${INTERVAL_SEC}s — SSH ${VPS}`);
setInterval(() => tick('poll'), INTERVAL_SEC * 1000);
tick('startup');

process.on('SIGINT', () => {
  log('Runner detenido');
  process.exit(0);
});
