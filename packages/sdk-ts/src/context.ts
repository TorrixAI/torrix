import { AsyncLocalStorage } from "node:async_hooks";

export interface TorrixRunContext {
  trace_id?: string;
  session_id?: string;
  agent_name?: string;
  parent_run_id?: string;
  name?: string;
  last_run_id?: string;
}

export interface RunContextOptions {
  name?: string;
  traceId?: string;
  sessionId?: string;
  agentName?: string;
  parentRunId?: string;
}

const storage = new AsyncLocalStorage<TorrixRunContext>();

export function currentContext(): TorrixRunContext | undefined {
  return storage.getStore();
}

export function runContext<T>(options: RunContextOptions, fn: (context: TorrixRunContext) => T): T {
  const parent = storage.getStore() ?? {};
  const context: TorrixRunContext = {
    trace_id: options.traceId ?? parent.trace_id ?? randomId(),
    session_id: options.sessionId ?? parent.session_id,
    agent_name: options.agentName ?? parent.agent_name,
    parent_run_id: options.parentRunId ?? parent.last_run_id,
    name: options.name ?? parent.name,
    last_run_id: undefined,
  };
  return storage.run(context, () => fn(context));
}

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
