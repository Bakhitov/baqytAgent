import { PostgresStore, PgVector } from '@mastra/pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    '[Mastra] Missing required environment variable "DATABASE_URL" for Postgres integration.',
  );
}

export const postgresConnectionString = databaseUrl;

export const postgresStore = new PostgresStore({
  connectionString: postgresConnectionString,
});

export const postgresVectorStore = new PgVector({
  connectionString: postgresConnectionString,
});
