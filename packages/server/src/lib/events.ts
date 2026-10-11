import { EventEmitter } from "node:events";
import type { Eval, Run } from "../core/domain";

export const runEmitter = new EventEmitter();

export const evalEmitter = new EventEmitter();

export const MAX_SSE_CONNECTIONS = 100;

let sseConnections = 0;

export function serializeSse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function acquireSseSlot(): boolean {
  if (sseConnections >= MAX_SSE_CONNECTIONS) {
    return false;
  }
  sseConnections += 1;
  return true;
}

export function releaseSseSlot(): void {
  sseConnections = Math.max(0, sseConnections - 1);
}

export function emitRun(run: Run): void {
  runEmitter.emit("run", run);
}

export function emitEval(evalRecord: Eval): void {
  evalEmitter.emit("eval", evalRecord);
}