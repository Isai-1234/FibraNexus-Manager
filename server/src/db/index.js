import '../loadEnv.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../lib/config.js';

const connectionString = config.databaseUrl;
const max = config.dbPoolMax;

const queryClient = postgres(connectionString || 'postgresql://localhost:5432/postgres', {
  max,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: connectionString?.includes('supabase') ? 'require' : undefined,
  // drizzle 0.29 envía jsonb pre-serializado (mapToDriverValue = JSON.stringify);
  // el serializador por defecto de postgres-js volvería a quotearlo y la columna
  // quedaría como string JSON doble-codificado. Se pasa tal cual.
  types: {
    json: {
      to: 114,
      from: [114, 3802],
      serialize: (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
      parse: (value) => value,
    },
  },
});

export const db = drizzle(queryClient, { schema });
