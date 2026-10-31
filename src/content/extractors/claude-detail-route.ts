export const CLAUDE_ORIGIN = 'https://claude.ai';
export const CLAUDE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ORGANIZATION_RESOURCE_PATH =
  /^\/api\/organizations\/([0-9a-f-]{36})\/chat_conversations\/([0-9a-f-]{36})$/;

/** Match only this conversation's exact previously observed detail URL, newest first. */
function organizationFromResources(conversationId: string): string | null {
  try {
    const resources = performance.getEntriesByType('resource');
    for (let index = resources.length - 1; index >= 0; index -= 1) {
      let url: URL;
      try {
        url = new URL(resources[index].name);
      } catch {
        continue;
      }
      if (url.origin !== CLAUDE_ORIGIN || url.search || url.hash || url.username || url.password)
        continue;
      const match = ORGANIZATION_RESOURCE_PATH.exec(url.pathname);
      if (match && match[2] === conversationId && CLAUDE_UUID_PATTERN.test(match[1]))
        return match[1];
    }
  } catch {
    // Resource timing can be unavailable; only named page hints are eligible below.
  }
  return null;
}

function organizationFromStorage(): string | null {
  try {
    const organizationId = localStorage.getItem('ccd-sync-org');
    return organizationId !== null && CLAUDE_UUID_PATTERN.test(organizationId)
      ? organizationId
      : null;
  } catch {
    return null;
  }
}

/** Verification banners expose only the current org and route, never a credential. */
function organizationFromVerificationLink(conversationId: string): string | null {
  try {
    const banner = document.querySelector('[data-organization-banners]');
    if (!banner) return null;
    for (const link of banner.querySelectorAll<HTMLAnchorElement>(
      'a[href^="https://portal.anthropic.com/verify?"]'
    )) {
      let url: URL;
      try {
        url = new URL(link.href);
      } catch {
        continue;
      }
      if (
        url.origin !== 'https://portal.anthropic.com' ||
        url.pathname !== '/verify' ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.get('return_to') !== 'claude' ||
        url.searchParams.get('return_path') !== `/chat/${conversationId}`
      ) {
        continue;
      }
      const organizationId = url.searchParams.get('org');
      if (organizationId !== null && CLAUDE_UUID_PATTERN.test(organizationId))
        return organizationId;
    }
  } catch {
    // The banner is optional and provider-controlled.
  }
  return null;
}

/** Resolve a non-secret route hint synchronously so DOM fallback keeps its original timer order. */
export function resolveClaudeOrganizationId(conversationId: string): string | null {
  if (!CLAUDE_UUID_PATTERN.test(conversationId)) return null;
  return (
    organizationFromResources(conversationId) ??
    organizationFromVerificationLink(conversationId) ??
    organizationFromStorage()
  );
}
