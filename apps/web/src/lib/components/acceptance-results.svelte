<script lang="ts">
	import { resolve } from '$app/paths';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import type { AcceptanceReport } from '@code-assist/intake/acceptance-types';
	let { run }: { run: CodingDetail } = $props();
	const latestAttempt = $derived(run.steps.findLast((s) => s.kind === 'accept'));
	const reports = $derived(
		run.steps
			.filter(
				(s) => s.kind === 'collect' && s.status === 'completed' && s.continuation?.kind === 'accept'
			)
			.toReversed()
	);
	const commits = $derived(
		Object.fromEntries(
			run.repositories
				? run.repositories.map((r) => [r.name, r.commit])
				: [[run.input.snapshot.name, run.commit]]
		)
	);
</script>

{#if run.plan.acceptanceScenarios}
	<section class="space-y-3 rounded-lg border p-4" aria-label="Acceptance Results">
		<h3 class="font-semibold">Acceptance Results</h3>
		{#if !reports.length}
			<p class="text-sm text-muted-foreground">
				The approved scenarios will be checked after command validation. No acceptance results yet.
			</p>
		{/if}
		{#each reports as step, index (step.id)}
			{@const report = step.result as AcceptanceReport}
			{@const current =
				index === 0 &&
				(latestAttempt?.recovery_step_id ?? latestAttempt?.id) === report.attemptId &&
				report.planHash === run.input.planHash &&
				Object.keys(commits).length === Object.keys(report.commits).length &&
				Object.entries(commits).every(([name, sha]) => report.commits[name] === sha) &&
				(step.change_request_id ?? null) === (run.change_requests?.at(-1)?.id ?? null) &&
				(step.direction_response_id ?? null) === (run.direction_responses?.at(-1)?.id ?? null)}
			<details open={index === 0} class="space-y-3">
				<summary class="cursor-pointer text-sm font-medium"
					>{current ? 'Current Candidate' : 'Earlier Evidence'} · {report.passed
						? 'Passed'
						: 'Incomplete or Failed'} · {new Date(step.created_at).toLocaleString()}</summary
				>
				<p class="text-sm">{report.summary}</p>
				<p class="text-xs break-all text-muted-foreground">
					Tested Commits: {Object.entries(report.commits)
						.map(([name, sha]) => `${name}: ${sha}`)
						.join(' · ')}
				</p>
				{#if !current}<p class="text-sm">
						This evidence does not establish acceptance for the current attempt, candidate and
						request.
					</p>{/if}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead
							><tr class="border-b"
								><th class="p-2">Scenario</th><th class="p-2">Result</th><th class="p-2"
									>Observation and Evidence</th
								></tr
							></thead
						>
						<tbody
							>{#each run.plan.acceptanceScenarios as scenario (scenario.id)}
								{@const outcome = report.scenarios.find((s) => s.id === scenario.id)}
								{@const evidenceIssues = report.issues.filter(
									(issue) =>
										issue.startsWith(scenario.id + ':') ||
										outcome?.artifacts.some((path) => issue.includes(path))
								)}
								<tr class="border-b align-top">
									<td class="p-2"
										><strong>{scenario.title}</strong>
										<div class="text-xs text-muted-foreground">
											{scenario.id} · {scenario.repositories.join(', ')} · {scenario.method}
										</div>
										<p class="mt-1">Expected: {scenario.expectedOutcome}</p></td
									>
									<td class="p-2"
										>{outcome?.status === 'passed' && evidenceIssues.length
											? 'Evidence Incomplete'
											: (outcome?.status ?? 'missing')}</td
									>
									<td class="space-y-2 p-2"
										><p class="whitespace-pre-wrap">
											{outcome?.observed ?? 'No result was supplied.'}
										</p>
										{#if outcome?.toolCallIds.length}<a
												class="underline"
												href={resolve(`/logs?attempt=${report.attemptId}`)}>Tool Evidence →</a
											>
											<div class="text-xs break-all">{outcome.toolCallIds.join(', ')}</div>{/if}
										{#each outcome?.artifacts ?? [] as path, i (i)}<p class="text-xs break-all">
												Saved Artifact: {path}
											</p>{/each}
									</td>
								</tr>
							{/each}</tbody
						>
					</table>
				</div>
				{#if report.issues.length}<ul class="list-disc pl-5 text-sm">
						{#each report.issues as issue, i (i)}<li>{issue}</li>{/each}
					</ul>{/if}
				<p class="text-xs text-muted-foreground">
					Evidence coverage is checked by the controller. Independent review must still assess
					whether the observations prove the expected behavior.
				</p>
			</details>
		{/each}
	</section>
{/if}
