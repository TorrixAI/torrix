export interface TorrixRecordBody {
  body?: unknown;
}

export interface TorrixRecord {
  id?: string;
  name?: string;
  provider?: string;
  model?: string;
  status?: number;
  error?: string;
  request?: TorrixRecordBody;
  response?: TorrixRecordBody;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  start_time?: string;
  end_time?: string;
  target_url?: string;
  trace_id?: string;
  session_id?: string;
  parent_run_id?: string;
  agent_name?: string;
  agent_id?: string;
  end_user_id?: string;
  tags?: Record<string, string>;
  retrieval_docs?: unknown[];
  project_id?: string;
  source?: string;
  dataset_id?: string;
  dataset_row_id?: string;
  [key: string]: unknown;
}
