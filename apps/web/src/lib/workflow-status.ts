import type { WorkItem } from '@code-assist/intake';

type WorkflowStatus =
	| WorkItem['coding_status']
	| WorkItem['planning_status']
	| WorkItem['discovery_status']
	| 'needs_repositories';

export function workflowBadgeVariant(status: WorkflowStatus, current = true) {
	if (!current) return 'secondary';
	switch (status) {
		case 'needs_repositories':
		case 'questions':
		case 'awaiting_approval':
		case 'needs_direction':
		case 'failed':
		case 'pr_open':
			return 'attention';
		case 'queued':
		case 'running':
		case 'drafting':
		case 'reviewing':
		case 'revising':
		case 'prepare':
		case 'implement':
		case 'validate':
		case 'review':
		case 'publish':
			return 'active';
		default:
			return 'secondary';
	}
}
