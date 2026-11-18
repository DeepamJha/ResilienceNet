export type PlaybookStep = { id: string; dependsOn?: string[]; approvalCheckpoint?: boolean; run: () => Promise<void> };

export class PlaybookEngine {
  private readonly paused = new Map<string, { steps: PlaybookStep[]; next: number }>();

  async execute(runId: string, steps: PlaybookStep[], approved = false): Promise<'completed' | 'paused'> {
    const indegree = new Map(steps.map((step) => [step.id, step.dependsOn?.length ?? 0]));
    const ready = steps.filter((step) => (indegree.get(step.id) ?? 0) === 0);
    const ordered: PlaybookStep[] = [];
    while (ready.length) {
      const step = ready.shift()!;
      ordered.push(step);
      for (const candidate of steps) {
        if (candidate.dependsOn?.includes(step.id)) {
          indegree.set(candidate.id, (indegree.get(candidate.id) ?? 1) - 1);
          if (indegree.get(candidate.id) === 0) ready.push(candidate);
        }
      }
    }
    if (ordered.length !== steps.length) throw new Error('Playbook contains a dependency cycle');
    const start = this.paused.get(runId)?.next ?? 0;
    for (let index = start; index < ordered.length; index++) {
      const step = ordered[index];
      if (step.approvalCheckpoint && !approved) {
        this.paused.set(runId, { steps: ordered, next: index });
        return 'paused';
      }
      await step.run();
    }
    this.paused.delete(runId);
    return 'completed';
  }
}
