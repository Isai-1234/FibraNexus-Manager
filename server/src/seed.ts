import { db } from './db/index.js';
import { users, clients, plans, clientServices, equipment, invoices, tickets } from './db/schema.js';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Creando datos de prueba...');

  const hashedPassword = await bcrypt.hash('123456', 10);

  // Admin
  const [admin] = await db.insert(users).values({
    email: 'admin@fibranexus.cl',
    password: hashedPassword,
    fullName: 'Administrador',
    role: 'admin',
    phone: '+56912345678',
  }).returning();

  // Técnico
  const [tech] = await db.insert(users).values({
    email: 'tecnico@fibranexus.cl',
    password: hashedPassword,
    fullName: 'Técnico de Red',
    role: 'technician',
    phone: '+56987654321',
  }).returning();

  // Clientes
  const clientsData = [
    { name: 'Juan Pérez', email: 'juan@email.com', type: 'individual', rut: '12345678-9', city: 'Santiago', region: 'Metropolitana' },
    { name: 'María García', email: 'maria@email.com', type: 'individual', rut: '98765432-1', city: 'Viña del Mar', region: 'Valparaíso' },
    { name: 'Comercial XYZ Ltda', email: 'empresa@email.com', type: 'business', rut: '76543210-K', city: 'Concepción', region: 'Biobío' },
  ];

  for (const cd of clientsData) {
    const [user] = await db.insert(users).values({
      email: cd.email,
      password: hashedPassword,
      fullName: cd.name,
      role: 'client',
    }).returning();

    await db.insert(clients).values({
      userId: user.id,
      clientType: cd.type as any,
      rut: cd.rut,
      city: cd.city,
      region: cd.region,
      address: `Dirección de prueba en ${cd.city}`,
    });
  }

  // Planes
  const plansData = [
    { name: 'Fibra 100 Megas', type: 'fiber', download: 100, upload: 50, price: '19990' },
    { name: 'Fibra 300 Megas', type: 'fiber', download: 300, upload: 150, price: '24990' },
    { name: 'Fibra 600 Megas', type: 'fiber', download: 600, upload: 300, price: '29990' },
    { name: 'WISP 50 Megas', type: 'wisp', download: 50, upload: 25, price: '14990' },
    { name: 'Fibra 1 Giga', type: 'fiber', download: 1000, upload: 500, price: '39990' },
  ];

  for (const pd of plansData) {
    await db.insert(plans).values({
      name: pd.name,
      type: pd.type as any,
      downloadSpeed: pd.download,
      uploadSpeed: pd.upload,
      price: pd.price,
      features: ['Internet ilimitado', 'Soporte 24/7', 'IP dinámica'],
    });
  }

  console.log('✅ Datos creados exitosamente!');
  console.log('📧 admin@fibranexus.cl / 123456');
  console.log('📧 tecnico@fibranexus.cl / 123456');
  console.log('📧 juan@email.com / 123456');
}

seed().catch(console.error).finally(() => process.exit());
