import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '../domain/ports.js';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
