import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { LinearClient } from "@linear/sdk";
import {
  isReady,
  issueFilter,
  readTickets,
  type Ticket,
} from "../src/linear.ts";
import { suggestRepositories } from "../src/repositories.ts";
import { attentionMessage } from "../src/worker.ts";
const ticket: Ticket = {
  id: "1",
  identifier: "ONE-1",
  title: "Fix embedded clipboard",
  description:
    "In elation_companion change iframe permissions. Related: https://github.com/OnetoOneHealth/workplace-agents/pull/96",
  url: "https://linear.app/example/issue/ONE-1",
  updatedAt: "2026-10-20T00:00:00.000Z",
  labels: ["Plan"],
  comments: [],
};
test("Plan without Code is the trigger; tracked IDs remain in the query", () => {
  assert(isReady(ticket));
  assert(!isReady({ ...ticket, labels: ["Plan", "Code"] }));
  assert(!isReady({ ...ticket, labels: ["Planning"] }));
  assert.deepEqual(issueFilter([]), {
    and: [
      { labels: { some: { name: { eq: "Plan" } } } },
      { labels: { every: { name: { neq: "Code" } } } },
    ],
  });
  assert.deepEqual(issueFilter(["tracked"]), {
    or: [issueFilter([]), { id: { in: ["tracked"] } }],
  });
});
test("suggestions retain explicit evidence without choosing a repo or mistaking substrings for names", () => {
  const repositories = [
    "elation_companion",
    "workplace-agents",
    "companion",
    "unrelated",
  ].map((name) => ({
    name,
    path: "/repos/" + name,
    github: "OnetoOneHealth/" + name,
  }));
  const suggestions = suggestRepositories(ticket, repositories);
  assert.deepEqual(
    suggestions.map((s) => s.repository.name),
    ["elation_companion", "workplace-agents"],
  );
  assert(
    suggestions[1].evidence.some((e) => e.includes("may be related work")),
  );
  assert.deepEqual(
    suggestRepositories(
      { ...ticket, description: "No repository reference here." },
      repositories,
    ),
    [],
  );
  assert.equal(
    suggestRepositories(
      {
        ...ticket,
        description: "",
        comments: [{ id: "c1", body: "See elation_companion" }],
      },
      repositories,
    )[0].repository.name,
    "elation_companion",
  );
});
test("attention HTML escapes ticket content and includes a direct decision link", () => {
  const message = attentionMessage(
    "abc",
    "ONE-1",
    '<img src=x> & "test"',
    new Date("2026-10-20T12:00:00Z"),
  );
  assert(message.includes("&lt;img"));
  assert(!message.includes("<img"));
  assert(message.includes("http://100.91.0.83:3000/tickets/abc"));
  assert(message.includes("EDT"));
});
test("native SDK pagination retains every issue, label and comment; errors omit credentials", async () => {
  const requests: { query: string; variables: Record<string, unknown> }[] = [];
  let reject = false;
  const pageInfo = (next: boolean) => ({
    hasNextPage: next,
    endCursor: next ? "next" : "end",
    hasPreviousPage: false,
    startCursor: "start",
  });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    res.setHeader("Content-Type", "application/json");
    if (reject) {
      res.statusCode = 401;
      res.end(JSON.stringify({ errors: [{ message: "fixture-private-key" }] }));
      return;
    }
    const next = body.variables?.after === "next";
    let data;
    if (/query issues\(/.test(body.query))
      data = {
        issues: {
          nodes: [
            {
              ...ticket,
              id: next ? "2" : "1",
              reactions: [],
              sharedAccess: { sharedWithUsers: [] },
            },
          ],
          pageInfo: pageInfo(!next),
        },
      };
    else if (/query issue_labels\(/.test(body.query))
      data = {
        issue: {
          id: body.variables.id,
          labels: {
            nodes: [{ id: next ? "l2" : "l1", name: next ? "Other" : "Plan" }],
            pageInfo: pageInfo(!next),
          },
        },
      };
    else if (/query issue_comments\(/.test(body.query))
      data = {
        issue: {
          id: body.variables.id,
          comments: {
            nodes: [
              {
                id: next ? "c2" : "c1",
                body: next ? "second comment" : "first comment",
                reactions: [],
              },
            ],
            pageInfo: pageInfo(!next),
          },
        },
      };
    else {
      res.statusCode = 400;
      res.end(
        JSON.stringify({ errors: [{ message: "Unexpected fixture query" }] }),
      );
      return;
    }
    res.end(JSON.stringify({ data }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const client = new LinearClient({
      apiKey: "fixture-private-key",
      apiUrl: `http://127.0.0.1:${address.port}`,
    });
    const result = await readTickets(client, []);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0].labels, ["Plan", "Other"]);
    assert.equal(result[0].comments.length, 2);
    for (const r of requests.filter((r) => /query issues\(/.test(r.query)))
      assert.deepEqual(r.variables.filter, issueFilter([]));
    reject = true;
    await assert.rejects(readTickets(client, []), (e) => {
      assert(e instanceof Error);
      assert(e.message.includes("401"));
      assert(!JSON.stringify(e).includes("fixture-private-key"));
      assert(!e.cause);
      return true;
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});
