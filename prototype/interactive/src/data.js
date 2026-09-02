/**
 * Datos fake embebidos — 82 clientes, 150 dispositivos, 300 facturas.
 * Generados determinísticamente para consistencia entre recargas.
 */

const PLANS = ['Plan Básico 25M', 'Plan Hogar 50M', 'Plan Pro 100M', 'Plan Rural 25Mbps', 'Plan Empresa 200M'];
const FIRST = ['Camila', 'Andrés', 'María', 'José', 'Ana', 'Carlos', 'Lucía', 'Pedro', 'Sofía', 'Diego', 'Valentina', 'Matías', 'Francisca', 'Sebastián', 'Javiera'];
const LAST = ['Rojas', 'Muñoz', 'González', 'Pérez', 'Silva', 'Hidalgo', 'Torres', 'Vargas', 'Morales', 'Soto', 'Fuentes', 'Contreras', 'Araya', 'Navarro', 'Castillo'];
const DEVICE_PREFIX = ['Sectorial', 'AP Torre', 'LiteBeam', 'NanoStation', 'Rocket', 'PowerBeam', 'Loco', 'Prism', 'LiteAP', 'Wave'];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function randomDate(daysAgo, seed) {
  const d = new Date();
  d.setDate(d.getDate() - (seed % daysAgo));
  d.setHours(8 + (seed % 10), seed % 60, 0, 0);
  return d.toISOString();
}

function macFromId(id) {
  const h = (n) => pad((id * 17 + n * 31) % 256);
  return `${h(1)}:${h(2)}:${h(3)}:${h(4)}:${h(5)}:${h(6)}`;
}

/** @returns {import('./types').Client[]} */
export function generateClients() {
  const clients = [];
  for (let i = 1; i <= 82; i++) {
    const nombre = `${pick(FIRST, i)} ${pick(LAST, i * 3)} ${pick(LAST, i * 7).charAt(0)}.`;
    const estado = i % 11 === 0 ? 'suspended' : 'active';
    clients.push({
      id: i,
      nombre,
      plan: pick(PLANS, i),
      estado,
      balance: estado === 'suspended' ? Math.round(8000 + (i * 137) % 25000) : Math.round((i * 89) % 12000),
      ultimoPago: randomDate(90, i),
      notas: i % 5 === 0 ? 'Cliente preferente — llamar antes de cortar.' : '',
      servicios: [
        {
          id: `svc-${i}`,
          nombre: pick(PLANS, i),
          ip: `172.16.${Math.floor(i / 50) + 11}.${(i % 240) + 10}`,
          estado,
        },
      ],
      deviceId: null, // asignado después
    });
  }
  return clients;
}

/** @returns {import('./types').Device[]} */
export function generateDevices(clients) {
  const devices = [];
  for (let i = 1; i <= 150; i++) {
    const roll = i % 15;
    let estado = 'online';
    if (roll === 0) estado = 'offline';
    else if (roll === 1) estado = 'unknown';

    const signal = estado === 'online'
      ? -30 - (i * 7) % 70
      : estado === 'unknown'
        ? null
        : -95 - (i % 5);

    // Asignar 0–4 clientes por antena
    const connectedClientIds = [];
    const base = ((i - 1) * 2) % 82;
    const count = i % 5;
    for (let c = 0; c < count; c++) {
      const cid = (base + c) % 82 + 1;
      if (!connectedClientIds.includes(cid)) connectedClientIds.push(cid);
    }

    devices.push({
      id: i,
      nombre: `${pick(DEVICE_PREFIX, i)} ${pick(['Norte', 'Sur', 'Este', 'Oeste', 'Centro'], i)} #${pad(i)}`,
      estado,
      signal,
      uptimeHoras: estado === 'online' ? 24 + (i * 13) % 720 : 0,
      ultimaConexion: randomDate(3, i * 2),
      mac: macFromId(i),
      connectedClientIds,
    });
  }

  // Vincular clientes a su antena principal
  clients.forEach((cl, idx) => {
    const dev = devices[idx % 150];
    cl.deviceId = dev.id;
    if (!dev.connectedClientIds.includes(cl.id)) {
      dev.connectedClientIds.push(cl.id);
    }
  });

  return devices;
}

/** @returns {import('./types').Invoice[]} */
export function generateInvoices(clients) {
  const invoices = [];
  let id = 1;
  while (invoices.length < 300) {
    for (const cl of clients) {
      if (invoices.length >= 300) break;
      const paid = (id + cl.id) % 3 !== 0;
      invoices.push({
        id: id++,
        clientId: cl.id,
        clienteNombre: cl.nombre,
        monto: 12990 + ((cl.id * 503) % 20000),
        estado: paid ? 'paid' : 'pending',
        fecha: randomDate(180, id * 11),
        numero: `F-2026-${pad(id % 12 + 1)}-${String(cl.id).padStart(3, '0')}`,
      });
    }
  }
  return invoices;
}

export function createInitialState() {
  const clients = generateClients();
  const devices = generateDevices(clients);
  const invoices = generateInvoices(clients);
  return { clients, devices, invoices };
}

export function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CL');
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function signalBarColor(dbm) {
  if (dbm == null) return '#94a3b8';
  if (dbm > -75) return '#16a34a';
  if (dbm >= -90) return '#ca8a04';
  return '#dc2626';
}

export function signalBarWidth(dbm) {
  if (dbm == null) return 10;
  return Math.max(8, Math.min(100, 100 + dbm)); // -30 => 70%, -100 => 0%
}
