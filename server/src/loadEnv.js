import dotenv from 'dotenv';

/** Cargar .env antes de leer process.env (local). En Render las env ya vienen del dashboard. */
dotenv.config();
