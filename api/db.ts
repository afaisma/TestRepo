import { neon } from '@neondatabase/serverless';

let sqlSingleton: ReturnType<typeof neon> | null = null;

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) {
    throw new Error('Server missing DATABASE_URL');
  }
  if (!sqlSingleton) {
    sqlSingleton = neon(url);
  }
  return sqlSingleton;
}
