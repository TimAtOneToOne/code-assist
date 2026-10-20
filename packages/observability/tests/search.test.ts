import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { parseFilters, searchLogs } from "../src/search.ts";

test("search escapes literals, exposes pagination and preserves partial-result warnings", async (t) => {
  const requests: {
    query: {
      sql: string;
      from: number;
      size: number;
      start_time: number;
      end_time: number;
    };
  }[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Basic test-only");
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        hits: Array.from(
          { length: request.query.from === 0 ? 101 : 1 },
          (_, i) => ({ event_id: String(i + request.query.from) }),
        ),
        is_partial: request.query.from !== 0,
      }),
    );
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const filters = parseFilters(
    new URLSearchParams({ attempt: "x' OR 1=1 --", end: "1792468560291" }),
  );
  const first = await searchLogs(url, "Basic test-only", filters);
  assert.equal(first.rows.length, 100);
  assert.equal(first.nextOffset, 100);
  assert.equal(first.partial, false);
  assert.match(requests[0].query.sql, /attempt_id = 'x'' OR 1=1 --'/);
  assert.equal(requests[0].query.start_time, 1000);
  const next = await searchLogs(url, "Basic test-only", {
    ...filters,
    offset: first.nextOffset!,
  });
  assert.equal(next.rows[0].event_id, "100");
  assert.equal(next.nextOffset, null);
  assert.equal(next.partial, true);
  assert.equal(requests[0].query.end_time, requests[1].query.end_time);
});

test("invalid pagination and invalid time ranges fail explicitly", () => {
  for (const query of [
    "offset=-1",
    "offset=1.5",
    "start=0",
    "end=NaN",
    "start=10&end=9",
    "end=9999999999999999",
  ]) {
    assert.throws(
      () => parseFilters(new URLSearchParams(query)),
      /Invalid time/,
    );
  }
});
