// S02: DAG logic

import type { SessionDef, SessionManifest } from './types.js';

/**
 * Validates that no cycles exist in the session dependency graph.
 * Uses DFS-based cycle detection. Throws an Error with the cycle path if a cycle is found.
 */
export function validateNoCycles(sessions: SessionDef[]): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const s of sessions) {
    color.set(s.id, WHITE);
  }

  const adjacency = new Map<string, string[]>();
  for (const s of sessions) {
    adjacency.set(s.id, s.depends_on);
  }

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);

    const deps = adjacency.get(nodeId) ?? [];
    for (const dep of deps) {
      const depColor = color.get(dep);

      if (depColor === GRAY) {
        // Build cycle path
        const cyclePath: string[] = [dep, nodeId];
        let current = nodeId;
        while (current !== dep) {
          const p = parent.get(current);
          if (p === null || p === undefined) break;
          cyclePath.push(p);
          current = p;
        }
        cyclePath.reverse();
        throw new Error(`Cycle detected in session dependencies: ${cyclePath.join(' -> ')}`);
      }

      if (depColor === WHITE) {
        parent.set(dep, nodeId);
        dfs(dep);
      }
    }

    color.set(nodeId, BLACK);
  }

  for (const s of sessions) {
    if (color.get(s.id) === WHITE) {
      parent.set(s.id, null);
      dfs(s.id);
    }
  }
}

/**
 * Returns sessions in valid execution order using Kahn's algorithm (BFS topological sort).
 * Sessions with no dependencies appear first.
 * Throws if depends_on references a non-existent session ID.
 */
export function topologicalSort(sessions: SessionDef[]): SessionDef[] {
  const sessionMap = new Map<string, SessionDef>();
  for (const s of sessions) {
    sessionMap.set(s.id, s);
  }

  // Validate all dependency references
  for (const s of sessions) {
    for (const dep of s.depends_on) {
      if (!sessionMap.has(dep)) {
        throw new Error(
          `Session "${s.id}" depends on "${dep}", which does not exist in the manifest`
        );
      }
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const s of sessions) {
    inDegree.set(s.id, s.depends_on.length);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: SessionDef[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(sessionMap.get(current)!);

    // Find sessions that depend on current
    for (const s of sessions) {
      if (s.depends_on.includes(current)) {
        const newDegree = inDegree.get(s.id)! - 1;
        inDegree.set(s.id, newDegree);
        if (newDegree === 0) {
          queue.push(s.id);
        }
      }
    }
  }

  if (sorted.length !== sessions.length) {
    throw new Error('Cycle detected in session dependencies: topological sort could not complete');
  }

  return sorted;
}

/**
 * Returns sessions whose all dependencies are satisfied (present in completedIds).
 */
export function getReadySessions(
  sessions: SessionDef[],
  completedIds: Set<string>
): SessionDef[] {
  return sessions.filter(s =>
    s.depends_on.length === 0 ||
    s.depends_on.every(dep => completedIds.has(dep))
  ).filter(s => !completedIds.has(s.id));
}

/**
 * Returns true if all dependencies of the given session are in completedIds.
 */
export function canExecute(
  sessionId: string,
  sessions: SessionDef[],
  completedIds: Set<string>
): boolean {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) {
    throw new Error(`Session "${sessionId}" not found`);
  }
  return session.depends_on.every(dep => completedIds.has(dep));
}

/**
 * Validates overall manifest consistency.
 * Returns an array of error strings — empty array means valid.
 */
export function validateManifest(manifest: SessionManifest): string[] {
  const errors: string[] = [];

  // Check unique IDs
  const ids = new Set<string>();
  for (const s of manifest.sessions) {
    if (ids.has(s.id)) {
      errors.push(`Duplicate session ID: "${s.id}"`);
    }
    ids.add(s.id);
  }

  // Check dependency references exist
  for (const s of manifest.sessions) {
    for (const dep of s.depends_on) {
      if (!ids.has(dep)) {
        errors.push(`Session "${s.id}" depends on "${dep}", which does not exist`);
      }
    }
  }

  // Check self-dependencies
  for (const s of manifest.sessions) {
    if (s.depends_on.includes(s.id)) {
      errors.push(`Session "${s.id}" depends on itself`);
    }
  }

  // Check total_sessions matches
  if (manifest.total_sessions !== manifest.sessions.length) {
    errors.push(
      `total_sessions is ${manifest.total_sessions} but manifest contains ${manifest.sessions.length} sessions`
    );
  }

  // Check for cycles (only if no ref errors found, to avoid confusing messages)
  const hasRefErrors = errors.some(e => e.includes('does not exist'));
  if (!hasRefErrors) {
    try {
      validateNoCycles(manifest.sessions);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  // Validate required fields
  for (const s of manifest.sessions) {
    if (!s.id) errors.push('Session found with empty id');
    if (!s.name) errors.push(`Session "${s.id}" has empty name`);
    if (!s.prompt) errors.push(`Session "${s.id}" has empty prompt`);
  }

  return errors;
}
