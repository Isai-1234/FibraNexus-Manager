import { db } from './db/index.js';
import { users, clients, plans } from './db/schema.js';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Creando datos de prueba...');
  const hashedPassword = await bcrypt.hash('123456', 10);

  await db.insert(users).values({
    email: 'admin@fibranexus.cl', password: hashedPassword,
    fullName: 'Administrador', role: 'admin', phone: '+56912345678',
  });

  await db.insert(users).values({
    email: 'tecnico@fibranexus.cl', password: hashedPassword,
    fullName: 'Técnico de Red', role: 'technician', phone: '+56987654321',
  });

  const plansData = [
    { name: 'Fibra 100 Megas', type: 'fiber', downloadSpeed: 100, uploadSpeed: 50, price: '19990' },
    { name: 'Fibra 300 Megas', type: 'fiber', downloadSpeed: 300, uploadSpeed: 150, price: '24990' },
    { name: 'Fibra 600 Megas', type: 'fiber', downloadSpeed: 600, uploadSpeed: 300, price: '29990' },
    { name: 'WISP 50 Megas', type: 'wisp', downloadSpeed: 50, uploadSpeed: 25, price: '14990' },
    { name: 'Fibra 1 Giga', type: 'fiber', downloadSpeed: 1000, uploadSpeed: 500, price: '39990' },
  ];

  for (const pd of plansData) {
    await db.insert(plans).values(pd);
  }

  console.log('✅ Datos creados! admin@fibranexus.cl / 123456');
}

seed().catch(console.error).finally(() => process.exit());
