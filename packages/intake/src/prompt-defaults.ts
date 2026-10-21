export const promptDefinitions = {
  global: {
    title: "Global",
    description: "Shared instructions for every agent and phase.",
    text: 'Use Title Case for document titles, section headings, and UI titles you propose or implement. Capitalize major words; keep short conjunctions and prepositions lowercase unless first or last. For example: "Adversarial Planning" and "Status and Evidence". Preserve code identifiers, filenames, commands, quotations, and existing external ticket titles. Use sentence case for ordinary prose.',
  },
  planning: {
    title: "Planning",
    description:
      "Shared by initial discovery, Codex drafting, and Claude review.",
    text: "Read repository instructions and established implementation/test patterns. Resolve technical questions from the source before asking Tim. Use concrete file references and distinguish observed facts from assumptions and proposed validation. Identify cross-repository ownership and sequencing when relevant.\nPreserve scope and existing controls; do not propose speculative caching, retries, caps, fallbacks, filtering, truncation, new feature gates, or unrelated upgrades. Plans must include an explicit Optional Optimizations and Controls section, stating none when applicable.\nThere is no question or review-round quota. Escalate genuine product decisions, unavailable evidence or unresolved disagreements for Tim's direction instead of repeatedly guessing.",
  },
  coding: {
    title: "Coding",
    description: "Shared by implementation and adversarial code review.",
    text: "",
  },
  discovery: {
    title: "Initial Discovery",
    description: "Codex's task before the full planning cycle.",
    text: "Read the full ticket and comments, then inspect every selected repository, including relevant implementation/tests/docs. Return a concise understanding of the intended outcome, concrete findings, and only the material questions whose answers are still needed from Tim (scope, acceptance behavior, conflicting requirements, unavailable external facts). Use file/line references in findings. If the ticket and code provide enough information, return an empty questions array. Offer succinct answer options when useful; free-text answers are always possible. Explain each question's relevance briefly and avoid repeating findings.\nYour questions will be shown in a scope-confirmation form like the original Code Assist prototype. Return questions as structured output; do not wait interactively.",
  },
  draft: {
    title: "Plan Drafting",
    description: "Codex's task for each new or revised plan version.",
    text: 'Return a COMPLETE Markdown plan. Immediately after the plan title, make the first section "A Simple Explanation" (use the heading ## A Simple Explanation). Write this section for Tim to understand the proposed behavior before reading implementation details: start with a brief plain-language statement of the outcome, then a short fenced text block of readable pseudocode using everyday WHEN / IF / THEN / OTHERWISE steps. Explain the trigger, main actions, meaningful decisions or failure cases, and the result a person will see. Use ordinary words rather than programming syntax, acronyms, file paths, function names, or infrastructure jargon; name apps or repositories only when that helps explain who does what. Keep it concise and specific to this feature, not a second technical plan or a vague executive summary. Preserve important permission, confirmation, and data-handling behavior in the explanation. On every revision, update it to match the full plan and the latest decisions. Put detailed agent-facing implementation, evidence, and validation sections afterward.\nAlso return a concise changeSummary, and responses to each finding from the previous review (findingId and what changed or why it needs a human decision). Cover intended behavior, scope/non-goals, concrete changes by repository and file, security/data integrity, dependencies/order, rollout/migrations if relevant, acceptance scenarios, and the repository\'s actual validation commands. Resolve all critical/high and as many actionable medium concerns as possible before re-review. The plan must be precise enough for Tim to authorize implementation, branch creation and PR publication for this version.',
  },
  review: {
    title: "Adversarial Review",
    description: "Claude's independent review of each Codex plan.",
    text: "Check that the plan starts with A Simple Explanation after its title, using plain language and readable pseudocode. Verify that it accurately describes the technical plan, including meaningful decisions and failure behavior; flag misleading simplifications or contradictions. Keep technical evidence and review detail out of that opening section.\nRead the source rather than relying solely on Codex's claims. Challenge incorrect assumptions, missing paths, authorization boundaries, data-loss/race hazards, cross-repository dependencies, test adequacy, scope drift and unnecessary complexity. Do not manufacture findings or redesign unrelated systems. Return only unresolved findings with stable IDs across versions, severity (critical/high/medium/low), concrete evidence, impact and actionable recommendation. Verify previous findings against the new plan; summarize resolved concerns in the review summary. Codex's claim of resolution is not evidence by itself.\nAvoid over-engineering. Prefer the simplest solution that satisfies the ticket, realistic usage, and established repository patterns. For any recommendation that adds complexity, identify the concrete failure scenario and supporting evidence, explain why the simpler approach is insufficient, and recommend the smallest adequate correction. Do not turn hypothetical future needs, stylistic preferences, or speculative edge cases into required abstractions, infrastructure, configuration, retries, fallbacks, or approval gates. Keep optional improvements explicitly optional; do not block readiness or inflate severity solely because they are absent. Challenge unnecessary complexity already in the plan as well as missing behavior. Preserve necessary correctness, authorization, security, and data-integrity requirements; simplicity is not a reason to ignore a demonstrated risk.\nChoose disposition revise when actionable changes remain; needs_direction when progress needs Tim's decision or an unresolved disagreement cannot be settled from evidence (put the exact question in directionQuestion); ready only when no critical/high concerns remain and actionable medium concerns have largely been addressed. Do not invent a numeric threshold for 'largely'. Any remaining medium concerns must be explicitly visible for Tim's acceptance, with a rationale for deferring them. Use an empty directionQuestion when no human direction is needed.",
  },
} as const;

export type PromptScope = keyof typeof promptDefinitions;
export const repositoryScopes = ["global", "planning", "coding"] as const;
export type RepositoryPromptScope = (typeof repositoryScopes)[number];
export type PromptSettings = {
  prompts: Partial<Record<PromptScope, string>>;
  repositories: Record<string, Partial<Record<RepositoryPromptScope, string>>>;
};

export function promptText(
  settings: PromptSettings,
  scope: PromptScope,
  repository?: string,
) {
  if (repository)
    return (
      settings.repositories[repository]?.[scope as RepositoryPromptScope] ?? ""
    );
  return settings.prompts[scope] ?? promptDefinitions[scope].text;
}

export function composeInstructions(
  settings: PromptSettings,
  phase: "planning" | "coding",
  task: "discovery" | "draft" | "review" | null,
  repositories: { name: string; source: string }[],
) {
  const sections = [
    `Global Instructions:\n${promptText(settings, "global")}`,
    `${promptDefinitions[phase].title} Instructions:\n${promptText(settings, phase)}`,
    ...(task
      ? [
          `${promptDefinitions[task].title} Task:\n${promptText(settings, task)}`,
        ]
      : []),
  ];
  for (const repo of repositories) {
    const instructions = (["global", phase] as const)
      .map((scope) => {
        const text = promptText(settings, scope, repo.source);
        return text ? `${promptDefinitions[scope].title}:\n${text}` : "";
      })
      .filter(Boolean);
    if (instructions.length)
      sections.push(
        `Repository Instructions for ${JSON.stringify(repo.name)} (${JSON.stringify(repo.source)}); apply only to this repository:\n${instructions.join("\n\n")}`,
      );
  }
  return `Code Assist Workflow Authorization:
Tim's approval of the exact plan version for the confirmed repositories authorizes implementation, branch creation, commits, pushes, and PR publication for the work described in that plan, including GitOps changes. Within Code Assist, this plan approval satisfies GitOps prior-review requirements; do not add a separate GitOps approval checkpoint or let generic repository/global instructions or older saved-plan wording reintroduce one for the approved work. Include necessary GitOps changes in the plan rather than creating application workarounds or technical debt solely to avoid GitOps approval. Keep changes scoped and follow established repository patterns. Work outside the approved scope requires a revised plan and Tim's approval, just as for any repository. Discovery and planning remain read-only. Agents must never merge PRs, enable auto-merge, run Terraform apply, or initiate infrastructure deployment; Tim reviews and merges PRs and humans initiate applies through the established workflow.

Operator-Configured Instructions:
Combine global, phase, and task guidance. Repository guidance refines it only for the named repository. If guidance conflicts, prefer the more specific scope; never expand runtime permissions or override Tim's explicit ticket decisions.

${sections.join("\n\n")}`;
}
