import { describe, it, expect } from 'vitest';
import { parsePlannedSubtasks, buildPlanPrompt, filterRecipes } from './planner.js';

describe('parsePlannedSubtasks', () => {
  it('parses a clean JSON object with a subtasks array', () => {
    const out = JSON.stringify({
      spec: 'Build a landing page',
      subtasks: [
        { title: 'Build frontend', agentType: 'frontend', dependsOnTitles: [] },
        { title: 'Review landing', agentType: 'reviewer', dependsOnTitles: ['Build frontend'] },
      ],
    });
    const subs = parsePlannedSubtasks(out);
    expect(subs.length).toBe(2);
    expect(subs[0].title).toBe('Build frontend');
    expect(subs[0].agentType).toBe('frontend');
    expect(subs[1].dependsOnTitles).toEqual(['Build frontend']);
  });

  it('strips surrounding prose and markdown fences', () => {
    const out = 'Here is my plan:\n```json\n' + JSON.stringify({
      spec: 'x',
      subtasks: [{ title: 'One' }, { title: 'Two' }],
    }) + '\n```\nDone.';
    const subs = parsePlannedSubtasks(out);
    expect(subs.map((s) => s.title)).toEqual(['One', 'Two']);
  });

  it('drops non-object and empty-title entries', () => {
    const out = JSON.stringify({
      spec: 'x',
      subtasks: [{ title: '' }, 'nope', { title: '  ' }, { title: 'Valid' }],
    });
    const subs = parsePlannedSubtasks(out);
    expect(subs.length).toBe(1);
    expect(subs[0].title).toBe('Valid');
  });

  it('handles braces/brackets inside the spec string (the real failure case)', () => {
    const out = JSON.stringify({
      spec: 'Remove ${var,,} and [[ =~ ]] and sed -i \'\' usage',
      subtasks: [{ title: 'Fix bash portability', agentType: 'backend' }],
    });
    const subs = parsePlannedSubtasks(out);
    expect(subs.length).toBe(1);
    expect(subs[0].title).toBe('Fix bash portability');
  });

  it('returns [] on garbage', () => {
    expect(parsePlannedSubtasks('no json here')).toEqual([]);
    expect(parsePlannedSubtasks('{"not":"an array"}')).toEqual([]);
    expect(parsePlannedSubtasks('{"spec":"only a spec"}')).toEqual([]);
  });
});

describe('buildPlanPrompt', () => {
  it('lists available recipes and forces reviewer last', () => {
    const recipes = [
      { name: 'frontend', title: 'Frontend', description: 'Builds UI' },
      { name: 'reviewer', title: 'Reviewer', description: 'Gates work' },
    ] as Array<{ name: string; title: string; description: string }>;
    const p = buildPlanPrompt('Build a landing', recipes as never);
    expect(p).toContain('Build a landing');
    expect(p).toContain('"frontend" (Frontend)');
    expect(p).toContain('"reviewer" (Reviewer)');
    expect(p).toContain('NOT write, edit, or execute any code yourself');
    expect(p).toContain('JSON object');
  });

  it('appends extra context when provided', () => {
    const p = buildPlanPrompt('x', [] as never, ['context line one', 'context line two']);
    expect(p).toContain('context line one');
    expect(p).toContain('context line two');
  });
});

describe('filterRecipes', () => {
  const recipes = [
    { name: 'frontend', title: 'Frontend', description: 'Builds UI' },
    { name: 'backend', title: 'Backend', description: 'Builds API' },
    { name: 'reviewer', title: 'Reviewer', description: 'Gates work' },
  ] as Array<{ name: string; title: string; description: string }>;

  it('returns all recipes when no selection is given', () => {
    expect(filterRecipes(recipes as never)).toHaveLength(3);
    expect(filterRecipes(recipes as never, [])).toHaveLength(3);
  });

  it('restricts to the user-selected recipes', () => {
    const filtered = filterRecipes(recipes as never, ['frontend', 'reviewer']);
    expect(filtered.map((r) => r.name)).toEqual(['frontend', 'reviewer']);
  });

  it('drops selections that match no recipe', () => {
    const filtered = filterRecipes(recipes as never, ['frontend', 'nope']);
    expect(filtered.map((r) => r.name)).toEqual(['frontend']);
  });
});
