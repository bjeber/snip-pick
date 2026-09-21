import { randomUUID } from 'node:crypto';

/** Indirection so tests can generate deterministic ids. */
export function newId(): string {
  return randomUUID();
}
