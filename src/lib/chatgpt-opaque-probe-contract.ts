/**
 * Serializable contract for the experimental, metadata-only ChatGPT opaque
 * request probe.  It intentionally contains neither request headers nor
 * conversation data, so it is safe to use across extension message boundaries.
 */

export const CHATGPT_OPAQUE_PROBE_OUTCOMES = [
  'target-not-observed',
  'source-not-native-request',
  'init-present',
  'init-security-sensitive',
  'init-unsupported',
  'target-mismatch',
  'clone-failed',
  'authorization-absent',
  'credentials-rejected',
  'source-rejected',
  'source-http-unauthorized',
  'source-http-forbidden',
  'source-http-rate-limited',
  'source-http-redirect',
  'source-http-error',
  'source-non-json',
  'eligible',
  'eligible-init-empty',
  'eligible-init-signal-only',
  'hook-state-failed',
  'probe-failed',
] as const;

export type ChatGptOpaqueProbeOutcome = (typeof CHATGPT_OPAQUE_PROBE_OUTCOMES)[number];

/** The bounded, credential-free fact set emitted by the page observer. */
export interface ChatGptOpaqueProbeResult {
  observedTargetRequest: boolean;
  sourceIsNativeRequest: boolean;
  initAbsent: boolean;
  exactTarget: boolean;
  authorizationPresent: boolean;
  credentialsAccepted: boolean;
  sourceStatus: number | null;
  sourceJson: boolean;
  singularDispatchCount: 0;
  outcome: ChatGptOpaqueProbeOutcome;
}

export type ChatGptOpaqueProbeResponse =
  | { success: true; data: ChatGptOpaqueProbeResult }
  | { success: false; data: ChatGptOpaqueProbeResult };

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  for (const expectedKey of expected) {
    let found = false;
    for (const key of keys) {
      if (key === expectedKey) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

export function createChatGptOpaqueProbeResult(
  outcome: ChatGptOpaqueProbeOutcome,
  overrides: Partial<Omit<ChatGptOpaqueProbeResult, 'outcome' | 'singularDispatchCount'>> = {}
): ChatGptOpaqueProbeResult {
  return {
    observedTargetRequest: false,
    sourceIsNativeRequest: false,
    initAbsent: false,
    exactTarget: false,
    authorizationPresent: false,
    credentialsAccepted: false,
    sourceStatus: null,
    sourceJson: false,
    singularDispatchCount: 0,
    ...overrides,
    outcome,
  };
}

function isBoundedSourceStatus(value: unknown): boolean {
  return (
    value === null ||
    (Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599)
  );
}

function hasBooleanProbeFlags(result: Record<string, unknown>): boolean {
  return [
    'observedTargetRequest',
    'sourceIsNativeRequest',
    'initAbsent',
    'exactTarget',
    'authorizationPresent',
    'credentialsAccepted',
    'sourceJson',
  ].every(key => typeof result[key] === 'boolean');
}

/** Validate every own key accepted from a page or content-script boundary. */
export function isChatGptOpaqueProbeResult(value: unknown): value is ChatGptOpaqueProbeResult {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !hasExactOwnKeys(value, [
      'observedTargetRequest',
      'sourceIsNativeRequest',
      'initAbsent',
      'exactTarget',
      'authorizationPresent',
      'credentialsAccepted',
      'sourceStatus',
      'sourceJson',
      'singularDispatchCount',
      'outcome',
    ])
  ) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    hasBooleanProbeFlags(result) &&
    isBoundedSourceStatus(result.sourceStatus) &&
    result.singularDispatchCount === 0 &&
    typeof result.outcome === 'string' &&
    (CHATGPT_OPAQUE_PROBE_OUTCOMES as readonly string[]).includes(result.outcome)
  );
}

export function isChatGptOpaqueProbeResponse(value: unknown): value is ChatGptOpaqueProbeResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return (
    hasExactOwnKeys(value, ['success', 'data']) &&
    typeof response.success === 'boolean' &&
    isChatGptOpaqueProbeResult(response.data)
  );
}
