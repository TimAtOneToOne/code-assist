import { createHash } from "node:crypto";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import { snapshots, commitSet } from "./coding-repositories.ts";
import { publicPublicationBody } from "./publication-metadata.ts";

export function publicationDescriptions(run: CodingRun, steps: CodingStep[]) {
  return Object.fromEntries(
    snapshots(run.input).flatMap((snapshot, index) => {
      const saved = steps.findLast(
        (s) =>
          s.kind === "collect" &&
          s.status === "completed" &&
          s.continuation?.kind === "implement" &&
          (s.repository_index ?? 0) === index &&
          s.result?.commit === commitSet(run)[snapshot.name] &&
          s.result?.disposition === "implemented",
      );
      const body = saved?.result?.pullRequestDescription;
      return typeof body === "string" && body.trim()
        ? [[snapshot.name, publicPublicationBody(body).trim() + "\n"]]
        : [];
    }),
  ) as Record<string, string>;
}

export function descriptionHashes(descriptions: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(descriptions).map(([name, body]) => [
      name,
      createHash("sha256").update(body).digest("hex"),
    ]),
  );
}

export const publicationDescriptionPath =
  "/opt/code-assist/publication-descriptions.json";

export function descriptionContext(run: CodingRun, steps: CodingStep[]) {
  const descriptions = publicationDescriptions(run, steps);
  return Object.keys(descriptions).length
    ? `Proposed PR descriptions are supplied read-only at ${publicationDescriptionPath}, keyed by repository name. Inspect these actual saved texts with native tools when checking PR-description requirements, and save observations under this attempt's evidence directory. They are proposed publication text, not existing GitHub PRs or proof of deployment. The controller publishes these reviewed descriptions. Missing or incorrect wording is an implementation defect to repair, not a request for Tim to create a PR or supply text. Review every description for the approved requirements, accurate validation claims, operator prerequisites, optional optimizations and controls, and external-content privacy.`
    : "This historical candidate has no saved proposed PR descriptions. If acceptance requires PR text, return failed so implementation can prepare it; do not require Tim to supply it or require a GitHub PR before publication.";
}
