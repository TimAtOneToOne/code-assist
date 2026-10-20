import { LinearClient, LinearError } from "@linear/sdk";
export class LinearScanError extends Error {}

export type Ticket = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string;
  updatedAt: string;
  labels: string[];
  comments: { id: string; body: string }[];
};

export function isReady(ticket: Ticket) {
  return ticket.labels.includes("Plan") && !ticket.labels.includes("Code");
}

export function issueFilter(trackedIds: string[]) {
  const ready = {
    and: [
      { labels: { some: { name: { eq: "Plan" } } } },
      { labels: { every: { name: { neq: "Code" } } } },
    ],
  };
  return trackedIds.length
    ? { or: [ready, { id: { in: trackedIds } }] }
    : ready;
}

export async function fetchTickets(
  token: string,
  trackedIds: string[],
  tokenType: "apiKey" | "accessToken",
): Promise<Ticket[]> {
  return readTickets(new LinearClient({ [tokenType]: token }), trackedIds);
}

export async function readTickets(
  client: LinearClient,
  trackedIds: string[],
): Promise<Ticket[]> {
  try {
    const issues = await client.issues({
      includeArchived: true,
      filter: issueFilter(trackedIds),
    });
    while (issues.pageInfo.hasNextPage) await issues.fetchNext();
    const tickets: Ticket[] = [];
    for (const issue of issues.nodes) {
      const labels = await issue.labels();
      while (labels.pageInfo.hasNextPage) await labels.fetchNext();
      const comments = await issue.comments();
      while (comments.pageInfo.hasNextPage) await comments.fetchNext();
      tickets.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        description: issue.description ?? "",
        updatedAt: issue.updatedAt.toISOString(),
        labels: labels.nodes.map((label) => label.name),
        comments: comments.nodes.map((comment) => ({
          id: comment.id,
          body: comment.body,
        })),
      });
    }
    return tickets;
  } catch (error) {
    // SDK errors retain request details; never propagate authentication headers.
    const status =
      error instanceof LinearError && error.status
        ? ` (HTTP ${error.status})`
        : "";
    throw new LinearScanError(
      `Linear scan failed${status}. Check the Linear credential.`,
    );
  }
}
