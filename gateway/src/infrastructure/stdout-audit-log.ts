import type { AuditEntry, AuditLog } from '../domain/ports.js';

/** Writes one JSON line per call to the given sink (stdout by default) for the platform log collector. */
export class JsonLinesAuditLog implements AuditLog {
  constructor(private readonly write: (line: string) => void = (line) => process.stdout.write(line)) {}

  async record(entry: AuditEntry): Promise<void> {
    this.write(`${JSON.stringify(entry)}\n`);
  }
}
