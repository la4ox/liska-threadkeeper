/** Ordinary exports retain confirmed immutable images; note/append policy stays with callers. */
import { inspectImagePlaceholders } from '../lib/image-output';
import {
  IMMUTABLE_IMAGE_NAMESPACE,
  planImmutableImageAssets,
  sameImageBytes,
  supportsImmutableImageWrites,
  type ImmutableImageAsset,
} from '../lib/immutable-image-assets';
import type { ObsidianApiClient } from '../lib/obsidian-api';
import { containsPathTraversal, resolvePathTemplate } from '../lib/path-utils';
import type { ExtensionSettings, ExtractedImage } from '../lib/types';

export interface OrdinaryImagePlan {
  readonly assets: readonly ImmutableImageAsset[];
  readonly namesById: ReadonlyMap<string, string>;
  readonly failedImageCount: number;
  readonly parserFailed: boolean;
}

/** Reject ambiguous IDs without letting one malformed image discard other valid assets. */
export async function prepareOrdinaryImagePlan(
  body: string,
  images: readonly ExtractedImage[]
): Promise<OrdinaryImagePlan> {
  const inspection = inspectImagePlaceholders(body);
  if (inspection.parserFailed) {
    return {
      assets: [],
      namesById: new Map(),
      failedImageCount:
        images.length > 0 ? Math.max(1, new Set(images.map(image => image.id)).size) : 0,
      parserFailed: true,
    };
  }
  const required = new Set(inspection.ids);
  const byId = new Map<string, ExtractedImage[]>();
  for (const image of images) {
    if (!required.has(image.id)) continue;
    const matches = byId.get(image.id) ?? [];
    matches.push(image);
    byId.set(image.id, matches);
  }
  const assets = new Map<string, ImmutableImageAsset>();
  const namesById = new Map<string, string>();
  let failedImageCount = 0;
  for (const id of required) {
    try {
      const planned = await planImmutableImageAssets(new Set([id]), byId.get(id) ?? []);
      const asset = [...planned.assetsByFileName.values()][0]!;
      const existing = assets.get(asset.sha256);
      if (
        existing &&
        (existing.mediaType !== asset.mediaType || !sameImageBytes(existing.bytes, asset.bytes))
      ) {
        throw new Error('Conflicting image bytes or MIME');
      }
      if (!existing) assets.set(asset.sha256, asset);
      namesById.set(id, asset.fileName);
    } catch {
      failedImageCount += 1;
    }
  }
  return { assets: [...assets.values()], namesById, failedImageCount, parserFailed: false };
}

export function ordinaryImageRelativePath(fileName: string): string {
  return `${IMMUTABLE_IMAGE_NAMESPACE}/${fileName}`;
}

type ImageClient = Pick<
  ObsidianApiClient,
  'getServerVersions' | 'getBinaryFileBounded' | 'putBinaryFileIfAbsent'
>;

/** Existing different/unknown bytes never authorize a PUT; every create needs exact readback. */
async function confirmAsset(
  client: ImageClient,
  path: string,
  asset: ImmutableImageAsset
): Promise<boolean> {
  const existing = await client.getBinaryFileBounded(path, asset.bytes.byteLength);
  if (existing !== null) return sameImageBytes(existing, asset.bytes);
  try {
    await client.putBinaryFileIfAbsent(path, asset.bytes, asset.mediaType);
  } catch {
    // 412 and uncertain PUT outcomes share one reconciliation rule below.
  }
  const readBack = await client.getBinaryFileBounded(path, asset.bytes.byteLength);
  return readBack !== null && sameImageBytes(readBack, asset.bytes);
}

/** Return only full vault-relative paths whose exact bytes have been confirmed. */
export async function persistOrdinaryObsidianImages(
  client: ImageClient,
  settings: ExtensionSettings,
  variables: Record<string, string>,
  plan: OrdinaryImagePlan
) {
  const pathsById = new Map<string, string>();
  let failedImageCount = plan.failedImageCount;
  if (plan.assets.length === 0) return { pathsById, failedImageCount };
  const pathsByName = new Map<string, string>();
  try {
    const root = resolvePathTemplate(settings.imageVaultPath, variables);
    const versions = await client.getServerVersions();
    if (!supportsImmutableImageWrites(versions.self)) throw new Error('Unsupported image writes');
    for (const asset of plan.assets) {
      const path = [root, ordinaryImageRelativePath(asset.fileName)].filter(Boolean).join('/');
      try {
        if (
          containsPathTraversal(path) ||
          path.includes('\\') ||
          path.split('/').some(part => !part || part === '.')
        ) {
          throw new Error('Invalid image path');
        }
        if (await confirmAsset(client, path, asset)) pathsByName.set(asset.fileName, path);
        else failedImageCount += 1;
      } catch {
        failedImageCount += 1;
      }
    }
  } catch {
    failedImageCount += plan.assets.length;
  }
  for (const [id, name] of plan.namesById) {
    const path = pathsByName.get(name);
    if (path) pathsById.set(id, path);
  }
  return { pathsById, failedImageCount };
}
