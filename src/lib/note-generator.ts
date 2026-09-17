/**
 * Note Content Generator
 *
 * Generates final markdown content with frontmatter from ObsidianNote.
 * Separated from background/service-worker.ts to avoid Chrome API dependency in tests.
 */

import { escapeYamlValue } from './yaml-utils';
import type { ObsidianNote, ExtensionSettings, NoteFrontmatter } from './types';

/** Evidence fields are always emitted, independent from optional note fields. */
function appendArchiveEvidence(lines: string[], frontmatter: NoteFrontmatter): void {
  if (frontmatter.capture_mode) {
    lines.push(`capture_mode: ${escapeYamlValue(frontmatter.capture_mode)}`);
  }
  if (frontmatter.capture_completeness) {
    lines.push(`capture_completeness: ${escapeYamlValue(frontmatter.capture_completeness)}`);
  }
  if (frontmatter.presentation_mode) {
    lines.push(`presentation_mode: ${escapeYamlValue(frontmatter.presentation_mode)}`);
  }
  if (frontmatter.branch_ordinal !== undefined) {
    lines.push(`branch_ordinal: ${frontmatter.branch_ordinal}`);
  }
  if (frontmatter.branch_count !== undefined) {
    lines.push(`branch_count: ${frontmatter.branch_count}`);
  }
  if (frontmatter.branch_point_count !== undefined) {
    lines.push(`branch_point_count: ${frontmatter.branch_point_count}`);
  }
  if (frontmatter.archive_capture_id) {
    lines.push(`archive_capture_id: ${escapeYamlValue(frontmatter.archive_capture_id)}`);
  }
}

/**
 * Generate full note content with frontmatter and body
 * Uses YAML escaping to prevent injection attacks (NEW-04)
 */
export function generateNoteContent(note: ObsidianNote, settings: ExtensionSettings): string {
  const { templateOptions } = settings;
  const lines: string[] = [];

  // Generate YAML frontmatter
  lines.push('---');

  if (templateOptions.includeId) {
    lines.push(`id: ${escapeYamlValue(note.frontmatter.id)}`);
  }

  if (templateOptions.includeTitle) {
    lines.push(`title: ${escapeYamlValue(note.frontmatter.title)}`);
  }

  if (templateOptions.includeSource) {
    lines.push(`source: ${escapeYamlValue(note.frontmatter.source)}`);
    lines.push(`url: ${escapeYamlValue(note.frontmatter.url)}`);
  }

  if (templateOptions.includeDates) {
    lines.push(`created: ${escapeYamlValue(note.frontmatter.created)}`);
    lines.push(`modified: ${escapeYamlValue(note.frontmatter.modified)}`);
  }

  if (templateOptions.includeTags && note.frontmatter.tags.length > 0) {
    lines.push('tags:');
    for (const tag of note.frontmatter.tags) {
      lines.push(`  - ${escapeYamlValue(tag)}`);
    }
  }

  if (templateOptions.includeMessageCount) {
    lines.push(`message_count: ${note.frontmatter.message_count}`);
  }

  // A partial DOM fallback and a derived branch must never look like an
  // unqualified complete source note.
  appendArchiveEvidence(lines, note.frontmatter);
  lines.push('---');
  lines.push('');

  // Add body
  lines.push(note.body);

  return lines.join('\n');
}
