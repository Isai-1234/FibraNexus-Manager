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
});

export const db = drizzle(queryClient, { schema });
