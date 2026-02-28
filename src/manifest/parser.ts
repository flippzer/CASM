// S02: Manifest parser

import { readJsonFile, writeJsonFile } from '../utils/file-ops.js';
import { validateManifest } from './dag.js';
import type { SessionManifest } from './types.js';

/**
 * Reads and parses a manifest JSON file. Runs validateManifest() and throws if invalid.
 */
export async function loadManifest(manifestPath: string): Promise<SessionManifest> {
  const manifest = await readJsonFile<SessionManifest>(manifestPath);
  const errors = validateManifest(manifest);

  if (errors.length > 0) {
    throw new Error(`Invalid manifest at "${manifestPath}":\n  - ${errors.join('\n  - ')}`);
  }

  return manifest;
}

/**
 * Saves a manifest to disk as formatted JSON.
 */
export async function saveManifest(manifest: SessionManifest, outputPath: string): Promise<void> {
  await writeJsonFile(outputPath, manifest);
}

/**
 * Parses a raw JSON string into a SessionManifest. Validates and throws if invalid.
 */
export function parseManifestJson(jsonString: string): SessionManifest {
  const parsed: unknown = JSON.parse(jsonString);
  const manifest = parsed as SessionManifest;
  const errors = validateManifest(manifest);

  if (errors.length > 0) {
    throw new Error(`Invalid manifest JSON:\n  - ${errors.join('\n  - ')}`);
  }

  return manifest;
}

/**
 * Creates a minimal valid manifest for a given project name.
 */
export function createEmptyManifest(project: string): SessionManifest {
  return {
    project,
    version: '1.0.0',
    total_sessions: 0,
    execution_model: 'sequential',
    sessions: [],
    created_at: new Date().toISOString(),
  };
}
