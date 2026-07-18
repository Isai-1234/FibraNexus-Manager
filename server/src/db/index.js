import '../loadEnv.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;
const max = parseInt(process.env.DB_POOL_MAX || '10', 10);

const queryClient = postgres(connectionString || 'postgresql://localhost:5432/postgres', {
  max,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: connectionString?.includes('supabase') ? 'require' : undefined,
});

export const db = drizzle(queryClient, { schema });
