/**
 * Tool names from a stored `tool_call` event. The event is normally a JSON
 * array/object with `name`, but large payloads are truncated at 4,000 chars so
 * the JSON no longer parses; recover the name from the raw text then.
 */
export function toolNameFromEventMessage(message: string): string | null {
  try {
    const parsed = JSON.parse(message) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const record = first as Record<string, unknown>;
      const fn = record.function && typeof record.function === "object" ? (record.function as Record<string, unknown>) : null;
      const name = record.name ?? record.toolName ?? record.tool_name ?? record.tool ?? fn?.name;
      if (typeof name === "string" && name.trim()) return name.trim().slice(0, 80);
    }
  } catch {
    // Truncated or plain-text tool event.
  }
  const match = /"(?:name|toolName|tool_name|tool)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(message);
  if (!match) return null;
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim().slice(0, 80) || null;
  } catch {
    return match[1].trim().slice(0, 80) || null;
  }
}
