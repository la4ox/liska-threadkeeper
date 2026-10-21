import type {
  AIPlatform,
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  ExtensionMessage,
  ObsidianNote,
  OutputDestination,
  PersistentOutputDestination,
  StructuredArchiveSource,
} from '../lib/types';

type ArchivePersistenceMessage = Extract<
  ExtensionMessage,
  { action: 'persistArchiveCompanion' | 'commitStagedArchiveCompanion' }
>;

function routingMetadata(capturedAt: string | undefined): { capturedAt?: string } {
  return capturedAt === undefined ? {} : { capturedAt };
}

/** Build one runtime-only archive route without serializing its resolved destination. */
export function buildArchivePersistenceMessage(input: {
  companion: ArchiveCompanionBundle;
  noteFileName: string;
  source: AIPlatform;
  stageSource: StructuredArchiveSource | undefined;
  artifact: ArchiveCompanionArtifact;
  outputs: PersistentOutputDestination[];
}): ArchivePersistenceMessage {
  const shared = {
    noteFileName: input.noteFileName,
    captureId: input.companion.captureId,
    conversationKey: input.companion.conversationKey,
    ...routingMetadata(input.companion.capturedAt),
    outputs: input.outputs,
  };
  if (input.artifact.transport === 'inline') {
    return {
      action: 'persistArchiveCompanion',
      source: input.source,
      ...shared,
      artifact: input.artifact,
    };
  }
  if (!input.stageSource) throw new Error('Staged archive routing requires a structured source.');
  return {
    action: 'commitStagedArchiveCompanion',
    source: input.stageSource,
    ...shared,
    artifact: input.artifact,
  };
}

/** Attach capture time only as optional runtime routing metadata. */
export function buildSaveToOutputsMessage(
  note: ObsidianNote,
  outputs: OutputDestination[],
  capturedAt?: string
): Extract<ExtensionMessage, { action: 'saveToOutputs' }> {
  return { action: 'saveToOutputs', data: note, outputs, ...routingMetadata(capturedAt) };
}
