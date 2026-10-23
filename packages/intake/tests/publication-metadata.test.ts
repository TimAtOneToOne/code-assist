import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ownsPublication,
  publicationMarker,
  publicPublicationBody,
} from "../src/publication-metadata.ts";

test("legacy PR metadata migrates without losing ownership or revision receipts", () => {
  const id = "12345678-abcd-abcd-abcd-123456789abc";
  const body = `## Summary

Keep this user-written context and [GitHub evidence](https://github.com/example/repo/actions/runs/1).

Validation: browser evidence and Claude’s combined adversarial review are recorded.
[Code Assist plan, validation and review](http://100.91.0.83:3000/tickets/${id})
Updated after fresh validation and Claude review. [Revision evidence](http://100.91.0.83:3000/tickets/${id}).
<!-- code-assist:${id} -->
<!-- code-assist-change:${id} -->`;
  assert(ownsPublication(body, id));
  const publicBody = publicPublicationBody(body);
  assert(ownsPublication(publicBody, id));
  assert(!ownsPublication(publicBody, "another-run"));
  assert.doesNotMatch(
    publicBody,
    /Code Assist|code-assist|100\.91\.0\.83|Claude/,
  );
  assert(publicBody.includes("Keep this user-written context"));
  assert(publicBody.includes("https://github.com/example/repo/actions/runs/1"));
  assert(publicBody.includes(publicationMarker(id)));
  assert(publicBody.includes(`<!-- revision:${id} -->`));
  assert.equal(publicPublicationBody(publicBody), publicBody);
});
