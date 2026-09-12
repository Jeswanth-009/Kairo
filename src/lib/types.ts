export interface Diagnostics {
  appVersion: string;
  schemaVersion: number;
  latestMigration: string;
  sqliteVersion: string;
  dbPath: string;
  migrationsApplied: string[];
}

export interface SmokeTestResult {
  ok: boolean;
  tokenWritten: string;
  tokenReadBack: string;
  durationMs: number;
  error: string | null;
}

export type DbStatus = "unverified" | "ok" | "error";
