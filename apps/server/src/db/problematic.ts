import type { Store, TaskRow } from './store.js';

export type ProblematicTask = {
  task: TaskRow;
  missionName: string | null;
  missionId: string;
  projectName: string | null;
  projectId: string;
};

/**
 * Tasks in a problem state (blocked), with a failed run, or a PR-review task
 * whose verdict needs action (needs_changes / reject), enriched with the
 * mission + project they belong to — enough to render the "Resume" section on
 * the home screen (tap a task → open its mission board).
 */
export function listProblematicTasks(store: Store): ProblematicTask[] {
  const all = store.listAllTasks();
  const out: ProblematicTask[] = [];
  for (const t of all) {
    const isProblem =
      t.state === 'blocked' ||
      t.run_state === 'failed' ||
      t.review_verdict === 'needs_changes' ||
      t.review_verdict === 'reject';
    if (!isProblem) continue;
    const mission = store.getMission(t.mission_id);
    const project = mission ? store.getProject(mission.project_id) : undefined;
    out.push({
      task: t,
      missionName: mission?.name ?? null,
      missionId: t.mission_id,
      projectName: project?.name ?? null,
      projectId: mission?.project_id ?? '',
    });
  }
  // Most recently updated first.
  out.sort((a, b) => b.task.updated_at - a.task.updated_at);
  return out;
}
