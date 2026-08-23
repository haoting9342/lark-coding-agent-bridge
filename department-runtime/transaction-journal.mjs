import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export class TransactionJournal {
  constructor(organizationRoot, transactionId, { now = () => new Date() } = {}) {
    this.file = path.join(organizationRoot, 'transactions', `${transactionId}.events.json`);
    this.now = now;
    this.entry = {
      schemaVersion: 1,
      transactionId,
      status: 'started',
      startedAt: this.now().toISOString(),
      steps: [],
    };
  }

  start(metadata) {
    this.entry = { ...this.entry, ...structuredClone(metadata) };
    this.#write();
  }

  step(name, details = {}) {
    this.entry.steps.push({ name, at: this.now().toISOString(), ...structuredClone(details) });
    this.#write();
  }

  finish(status, details = {}) {
    this.entry = {
      ...this.entry,
      ...structuredClone(details),
      status,
      finishedAt: this.now().toISOString(),
    };
    this.#write();
  }

  #write() {
    writeJsonAtomic(this.file, this.entry);
  }
}
