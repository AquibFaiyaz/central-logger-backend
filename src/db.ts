import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("[Database] Critical Error: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

console.log("[Database] Initializing PostgreSQL connection pool...");

const pool = new pg.Pool({
  connectionString,
  max: 20, // Max clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Initialize database schema
export async function initializeDatabaseSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("[Database] Initializing logs table and indexes...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id UUID PRIMARY KEY,
        app_id VARCHAR(100) NOT NULL,
        trace_id VARCHAR(100),
        type VARCHAR(50) NOT NULL,
        level VARCHAR(50) NOT NULL,
        message TEXT,
        timestamp TIMESTAMPTZ NOT NULL,
        payload JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_logs_app_id ON logs(app_id);
      CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    `);
    console.log("[Database] Schema successfully verified.");
  } catch (err: any) {
    console.error(`[Database] Error initializing schema: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

export interface LogEntryInput {
  id: string;
  appId: string;
  traceId?: string;
  type: "log" | "transaction";
  level: "info" | "warn" | "error" | "debug";
  message?: string;
  timestamp: string;
  payload?: any;
}

export async function insertLogEntry(entry: LogEntryInput): Promise<void> {
  const query = `
    INSERT INTO logs (id, app_id, trace_id, type, level, message, timestamp, payload)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `;
  const params = [
    entry.id,
    entry.appId,
    entry.traceId || null,
    entry.type,
    entry.level,
    entry.message || null,
    entry.timestamp,
    entry.payload ? JSON.stringify(entry.payload) : null,
  ];

  await pool.query(query, params);
}

export async function getRegisteredApps(): Promise<string[]> {
  const query = "SELECT DISTINCT app_id FROM logs ORDER BY app_id ASC";
  const result = await pool.query(query);
  return result.rows.map(r => r.app_id);
}

export interface QueryFilters {
  appId?: string;
  level?: string;
  traceId?: string;
  search?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export async function queryLogEntries(filters: QueryFilters): Promise<any[]> {
  let query = "SELECT * FROM logs WHERE 1=1";
  const params: any[] = [];
  let paramCounter = 1;

  if (filters.appId) {
    query += ` AND app_id = $${paramCounter}`;
    params.push(filters.appId);
    paramCounter++;
  }

  if (filters.level) {
    query += ` AND level = $${paramCounter}`;
    params.push(filters.level);
    paramCounter++;
  }

  if (filters.traceId) {
    query += ` AND trace_id = $${paramCounter}`;
    params.push(filters.traceId);
    paramCounter++;
  }

  if (filters.search) {
    query += ` AND (message ILIKE $${paramCounter} OR payload::text ILIKE $${paramCounter})`;
    const wildcardSearch = `%${filters.search}%`;
    params.push(wildcardSearch);
    paramCounter++;
  }

  if (filters.startTime) {
    query += ` AND timestamp >= $${paramCounter}`;
    params.push(filters.startTime);
    paramCounter++;
  }

  if (filters.endTime) {
    query += ` AND timestamp <= $${paramCounter}`;
    params.push(filters.endTime);
    paramCounter++;
  }

  query += " ORDER BY timestamp DESC";

  if (filters.limit !== undefined) {
    query += ` LIMIT $${paramCounter}`;
    params.push(filters.limit);
    paramCounter++;
  }

  if (filters.offset !== undefined) {
    query += ` OFFSET $${paramCounter}`;
    params.push(filters.offset);
    paramCounter++;
  }

  const result = await pool.query(query, params);
  
  return result.rows.map(row => ({
    id: row.id,
    appId: row.app_id,
    traceId: row.trace_id,
    type: row.type,
    level: row.level,
    message: row.message,
    timestamp: row.timestamp,
    payload: row.payload, // pg driver automatically parses JSONB as objects
  }));
}

export async function countLogEntries(filters: QueryFilters): Promise<number> {
  let query = "SELECT COUNT(*) as total FROM logs WHERE 1=1";
  const params: any[] = [];
  let paramCounter = 1;

  if (filters.appId) {
    query += ` AND app_id = $${paramCounter}`;
    params.push(filters.appId);
    paramCounter++;
  }

  if (filters.level) {
    query += ` AND level = $${paramCounter}`;
    params.push(filters.level);
    paramCounter++;
  }

  if (filters.traceId) {
    query += ` AND trace_id = $${paramCounter}`;
    params.push(filters.traceId);
    paramCounter++;
  }

  if (filters.search) {
    query += ` AND (message ILIKE $${paramCounter} OR payload::text ILIKE $${paramCounter})`;
    const wildcardSearch = `%${filters.search}%`;
    params.push(wildcardSearch);
    paramCounter++;
  }

  if (filters.startTime) {
    query += ` AND timestamp >= $${paramCounter}`;
    params.push(filters.startTime);
    paramCounter++;
  }

  if (filters.endTime) {
    query += ` AND timestamp <= $${paramCounter}`;
    params.push(filters.endTime);
    paramCounter++;
  }

  const result = await pool.query(query, params);
  return parseInt(result.rows[0].total, 10);
}

export async function deleteOldLogs(retentionHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
  const query = "DELETE FROM logs WHERE timestamp < $1";
  const result = await pool.query(query, [cutoff]);
  return result.rowCount || 0;
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

