export const pageSize = 100;
export type LogRow = Record<string, unknown>;
export type SearchFilters = {
  attempt: string;
  service: string;
  start: number;
  end: number;
  offset: number;
};
export function parseFilters(params: URLSearchParams): SearchFilters {
  const start = Number(params.get("start") ?? 1);
  const end = Number(params.get("end") ?? Date.now());
  const offset = Number(params.get("offset") ?? 0);
  if (
    ![start, end, offset].every(Number.isSafeInteger) ||
    start < 1 ||
    end <= start ||
    offset < 0 ||
    !Number.isSafeInteger(end * 1000)
  )
    throw new Error("Invalid time range or offset");
  return {
    start,
    end,
    offset,
    attempt: params.get("attempt") ?? "",
    service: params.get("service") ?? "",
  };
}
function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function searchLogs(
  url: string,
  authorization: string,
  filters: SearchFilters,
) {
  const conditions: string[] = [];
  if (filters.attempt)
    conditions.push(`attempt_id = ${literal(filters.attempt)}`);
  if (filters.service) conditions.push(`service = ${literal(filters.service)}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        sql: `SELECT * FROM code_assist${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY _timestamp DESC, process_instance_id DESC, sequence DESC, event_id DESC, log_file_path DESC, log_file_record_offset DESC`,
        start_time: filters.start * 1000,
        end_time: filters.end * 1000,
        from: filters.offset,
        size: pageSize + 1,
      },
    }),
  });
  if (!response.ok)
    throw new Error(`Log search failed (HTTP ${response.status})`);
  const result = (await response.json()) as {
    hits?: LogRow[];
    is_partial?: boolean;
    function_error?: string;
  };
  if (!Array.isArray(result.hits))
    throw new Error("Log search returned an invalid response");
  return {
    filters,
    rows: result.hits.slice(0, pageSize),
    nextOffset:
      result.hits.length > pageSize ? filters.offset + pageSize : null,
    partial: result.is_partial === true || Boolean(result.function_error),
  };
}
