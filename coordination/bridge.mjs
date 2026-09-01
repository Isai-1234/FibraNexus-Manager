#!/usr/bin/env node
/**
 * Claude ↔ Cursor Bridge — daemon portable entre proyectos.
 *
 * Uso:
 *   node coordination/bridge.mjs
 *   node coordination/bridge.mjs /ruta/a/bridge.config.json
 *
 * Variables de entorno:
 *   COORD_DIR  — carpeta coordination (default: ./coordination desde cwd)
 *   BRIDGE_CONFIG — ruta al config JSON
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function expandHome(p) {
  if (!p) return p;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return p.replace(/^~(?=$|[\\/])/, home);
}

function loadConfig() {
  const configArg = process.argv[2] || process.env.BRIDGE_CONFIG;
  const configPath = configArg
    ? path.resolve(configArg)
    : path.join(process.env.COORD_DIR ? path.resolve(process.env.COORD_DIR) : __dirname, 'bridge.config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const coordDir = process.env.COORD_DIR
    ? path.resolve(process.env.COORD_DIR)
    : path.resolve(path.dirname(configPath));
  return { raw, coordDir, configPath };
}

function paths(coordDir) {
  return {
    order: path.join(coordDir, 'order.json'),
    status: path.join(coordDir, 'status.json'),
    agent: path.join(coordDir, 'agent.json'),
    inbox: path.join(coordDir, 'INBOX.md'),
    lock: path.join(coordDir, '.bridge.lock'),
    state: path.join(coordDir, 'bridge-state.json'),
    log: path.join(coordDir, 'bridge.log'),
    reports: path.join(coordDir, 'reports'),
  };
}

function log(file, msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(file, line);
  process.stdout.write(line);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function sshExec(cfg, commands) {
  const nvm = cfg.ssh?.nvmBin || '/root/.nvm/versions/node/v20.20.2/bin';
  const script = [
    `export PATH=${nvm}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    ...(Array.isArray(commands) ? commands : []),
  ].join('\n');
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const key = expandHome(cfg.ssh?.keyPath);
  const host = cfg.ssh?.host;
  const args = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ConnectTimeout=${cfg.ssh?.connectTimeoutSec || 20}`,
  ];
  if (key && fs.existsSync(key)) args.push('-i', key);
  args.push(host, `echo ${b64} | base64 -d | bash`);

  const r = spawnSync('ssh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, shell: false });
  const output = (r.stdout || '') + (r.stderr || '');
  return { ok: r.status === 0, output, code: r.status };
}

function summarizeOutput(output, max = 400) {
  const lines = output.trim().split('\n').filter(Boolean);
  if (!lines.length) return '(sin output)';
  const last = lines.slice(-8).join(' | ');
  return last.length > max ? last.slice(-max) : last;
}

function processOrder(cfg, P) {
  const order = readJson(P.order);
  if (!order || order.status !== 'pending') return;

  const id = String(order.id || '?');
  const state = readJson(P.state, {});
  if (state.lastProcessedId === id) return;

  log(P.log, `ORDEN ${id} pending → ejecutando`);
  fs.writeFileSync(P.lock, JSON.stringify({ id, at: new Date().toISOString() }));

  const results = [];
  const cmds = order.vps_commands || [];
  for (let i = 0; i < cmds.length; i++) {
    log(P.log, `  cmd ${i + 1}/${cmds.length}: ${cmds[i].slice(0, 60)}...`);
    const r = sshExec(cfg.raw, [cmds[i]]);
    results.push({ cmd: cmds[i], ok: r.ok, output: r.output.slice(-12000) });
  }

  const allOk = results.every((r) => r.ok);
  const needsCursor = Boolean(order.needs_cursor);
  const finalStatus = needsCursor ? 'needs_cursor' : allOk ? 'ok' : 'failed';

  fs.mkdirSync(P.reports, { recursive: true });
  const reportFile = `reports/${id.padStart(3, '0')}-report.md`;
  const reportBody = `# ORDEN ${id}\n\n**task:** ${order.task || '-'}\n\n**status:** ${finalStatus}\n\n${results.map((r, i) => `## CMD ${i + 1} — ${r.ok ? 'OK' : 'FAIL'}\n\`\`\`\n${r.output}\n\`\`\``).join('\n\n')}\n`;
  fs.writeFileSync(path.join(P.reports, `${id.padStart(3, '0')}-report.md`), reportBody);

  const summary = order.task
    ? `${order.task.slice(0, 120)} — ${finalStatus}`
    : `${results.length} cmds — ${finalStatus}: ${summarizeOutput(results.at(-1)?.output || '')}`;

  writeJson(P.status, {
    id,
    status: finalStatus,
    summary,
    completed_at: new Date().toISOString(),
    report: reportFile,
    errors: results.filter((r) => !r.ok).map((r) => r.cmd),
    project: cfg.raw.projectName || path.basename(process.cwd()),
  });

  fs.writeFileSync(
    P.inbox,
    `# INBOX\n\n\`\`\`yaml\norder_id: "${id}"\nstatus: ${finalStatus}\nsummary: "${summary.replace(/"/g, "'")}"\n\`\`\`\n\nLee \`status.json\` (compacto) o \`${reportFile}\` (detalle).\n`,
  );

  if (needsCursor) {
    writeJson(P.agent, {
      order_id: id,
      status: 'pending',
      task: order.cursor_task || order.task || 'Ver order.json y ejecutar cambios de código',
      report: reportFile,
      created_at: new Date().toISOString(),
    });
    log(P.log, `ORDEN ${id} → agent.json (Cursor)`);
  }

  writeJson(P.order, { ...order, status: finalStatus === 'failed' ? 'failed' : 'done', completed_at: new Date().toISOString() });
  writeJson(P.state, { lastProcessedId: id, lastProcessedAt: new Date().toISOString() });
  if (fs.existsSync(P.lock)) fs.unlinkSync(P.lock);
  log(P.log, `ORDEN ${id} → ${finalStatus}`);
}

function tick(cfg, P) {
  try {
    if (fs.existsSync(P.lock)) return;
    processOrder(cfg, P);
  } catch (err) {
    log(P.log, `ERROR: ${err.message}`);
    if (fs.existsSync(P.lock)) fs.unlinkSync(P.lock);
  }
}

function main() {
  const cfg = loadConfig();
  const P = paths(cfg.coordDir);
  const interval = (cfg.raw.pollIntervalSec || 5) * 1000;

  log(P.log, `Bridge iniciado — ${cfg.raw.projectName || 'project'} — poll ${interval / 1000}s — ${cfg.raw.ssh?.host}`);
  log(P.log, `Config: ${cfg.configPath}`);

  if (!fs.existsSync(P.order)) {
    writeJson(P.order, {
      id: '000',
      status: 'idle',
      from: 'bridge',
      task: 'Esperando orden. Claude: escribe order.json con status pending.',
      vps_commands: [],
      needs_cursor: false,
    });
    writeJson(P.status, {
      id: '000',
      status: 'idle',
      summary: 'Bridge listo. Escribe order.json con status pending.',
      project: cfg.raw.projectName,
    });
  }

  tick(cfg, P);
  setInterval(() => tick(cfg, P), interval);

  fs.watch(P.order, () => setTimeout(() => tick(cfg, P), 200));
}

main();
