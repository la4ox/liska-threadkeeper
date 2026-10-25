import type { JsonValue, LiskaThreadArchive } from '../types';
import type { RawCaptureManifest } from '../capture';
import { SNAPSHOT_ANALYSIS_HARD_LIMITS, type SnapshotAnalysisLimits } from './contracts';
import { compare, equalBytes, fail, type OwnedFile } from './safe-input';

const encoder = new TextEncoder();

/** Only parsed owned JSON enters this serializer; no values are read from caller objects. */
export function stableJson(
  value: JsonValue,
  maxBytes = SNAPSHOT_ANALYSIS_HARD_LIMITS.maxProjectionBytes
): string {
  const parts: string[] = [];
  let bytes = 0;
  const append = (text: string) => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > maxBytes) fail('limit-exceeded');
    parts.push(text);
  };
  const write = (item: JsonValue): void => {
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'string' && item.length > maxBytes - bytes) fail('limit-exceeded');
      append(JSON.stringify(item));
    } else if (Array.isArray(item)) {
      append('[');
      item.forEach((entry, index) => {
        if (index > 0) append(',');
        write(entry);
      });
      append(']');
    } else {
      append('{');
      Object.keys(item)
        .sort(compare)
        .forEach((key, index) => {
          if (index > 0) append(',');
          append(JSON.stringify(key) + ':');
          write(item[key]);
        });
      append('}');
    }
  };
  write(value);
  return parts.join('');
}

export function writerBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2));
}

export function inventoryEqual(left: readonly OwnedFile[], right: readonly OwnedFile[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) =>
        file.path === right[index].path &&
        file.sha256 === right[index].sha256 &&
        equalBytes(file.bytes, right[index].bytes)
    )
  );
}

export function inventoryProjection(files: readonly OwnedFile[]): Uint8Array {
  // Public plans must not commit input slot names: opaque/title-derived paths
  // can otherwise be recovered by a small dictionary attack. Exact path
  // equality remains an internal requirement in inventoryEqual().
  const descriptors = files
    .map(file => ({ byteLength: file.bytes.byteLength, sha256: file.sha256 }))
    .sort(
      (left, right) => compare(left.sha256, right.sha256) || left.byteLength - right.byteLength
    );
  return encoder.encode(
    JSON.stringify({
      schema: 'liska-snapshot-inventory/1',
      files: descriptors,
    }) + '\n'
  );
}

/** Known capture-scoped input fields alone are omitted; provider extensions stay intact. */
export function semanticProjection(
  archive: LiskaThreadArchive,
  manifest: RawCaptureManifest
): JsonValue {
  const input = archive.inputs[0];
  return {
    schema: 'liska-snapshot-semantic/1',
    archive: {
      schema: archive.schema,
      archiveId: archive.archiveId,
      inputs: [
        {
          normalizer: input.normalizer,
          sourceRefs: input.sourceRefs,
          extensions: input.extensions,
        },
      ],
      conversation: archive.conversation,
      graph: archive.graph,
      assets: archive.assets,
      diagnostics: archive.diagnostics,
      extensions: archive.extensions,
    },
    evidence: {
      method: manifest.method,
      completeness: manifest.completeness,
      assets: manifest.assets,
      warnings: manifest.warnings,
      observedUnknownContentTypes: manifest.observedUnknownContentTypes,
      artifacts: manifest.artifacts.map(artifact => ({
        id: artifact.id,
        relativePath: artifact.relativePath,
        mediaType: artifact.mediaType,
        ...('endpoint' in artifact ? { endpoint: artifact.endpoint } : { source: artifact.source }),
      })),
    },
  } as unknown as JsonValue;
}

export function graphProjection(archive: LiskaThreadArchive): JsonValue {
  return {
    schema: 'liska-snapshot-graph/1',
    currentNodeId: archive.conversation.currentNodeId,
    rootIds: archive.graph.rootIds,
    nodes: Object.fromEntries(
      Object.entries(archive.graph.nodes).map(([id, node]) => [
        id,
        {
          id: node.id,
          parentId: node.parentId,
          childIds: node.childIds,
        },
      ])
    ),
  };
}

export function projectionBytes(
  value: JsonValue,
  limits: SnapshotAnalysisLimits,
  budget: { projectionBytes: number }
): { text: string; bytes: Uint8Array } {
  const available = Math.min(
    limits.maxProjectionBytes,
    limits.maxTotalProjectionBytes - budget.projectionBytes
  );
  if (available < 1) fail('limit-exceeded');
  const text = stableJson(value, available - 1);
  const bytes = encoder.encode(text + '\n');
  budget.projectionBytes += bytes.byteLength;
  if (
    bytes.byteLength > limits.maxProjectionBytes ||
    budget.projectionBytes > limits.maxTotalProjectionBytes
  )
    fail('limit-exceeded');
  return { text, bytes };
}
