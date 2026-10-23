export function publicationMarker(id: string) {
  return `<!-- publication:${id} -->`;
}

export function ownsPublication(body: string, id: string) {
  return (
    body.includes(publicationMarker(id)) ||
    body.includes(`<!-- code-assist:${id} -->`)
  );
}

// Migrate previously generated metadata when an owned PR is next updated.
export function publicPublicationBody(body: string) {
  return body
    .replace(/<!-- code-assist:([a-f0-9-]+) -->/g, "<!-- publication:$1 -->")
    .replace(
      /<!-- code-assist-change:([a-f0-9-]+) -->/g,
      "<!-- revision:$1 -->",
    )
    .replace(
      /\[(?:Code Assist[^\]]*|Revision evidence)\]\(https?:\/\/100\.91\.0\.83:3000\/tickets\/[a-f0-9-]+\)\.?/g,
      "",
    )
    .replaceAll("Claude’s combined adversarial review", "code review")
    .replaceAll(
      "fresh validation and Claude review",
      "fresh validation and code review",
    );
}
