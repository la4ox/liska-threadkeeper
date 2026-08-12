# ADR-002: Auto-Scroll for Gemini Long Conversation Extraction

| Field           | Value                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| **Document ID** | ADR-002                                                                           |
| **Date**        | 2026-02-20                                                                        |
| **Status**      | Accepted                                                                          |
| **Branch**      | `feature/gemini-auto-scroll`                                                      |
| **Issue**       | [#49](https://github.com/sho7650/obsidian-AI-exporter/issues/49)                  |
| **Related**     | [#44](https://github.com/sho7650/obsidian-AI-exporter/issues/44), PR #45 (closed) |

---

## Context

Gemini uses backward infinite scrolling for long conversations. Only recent messages are in the DOM; older ones load from the server when the user scrolls upward. The current `GeminiExtractor.extractMessages()` reads only DOM-present elements, silently truncating long conversations.

Investigation confirmed Gemini uses **append-only lazy loading** (NOT true virtual scroll). Once messages load into the DOM, they persist. `scrollTo({ top: 0 })` triggers server-side backfill.

---

## Decision

**Scroll-to-top with DOM stabilization** inside `GeminiExtractor`.

- Detect partial load via `scrollTop > 0` on `#chat-history`
- Programmatically `scrollTo({ top: 0 })` repeatedly (1s interval)
- Count `.conversation-container` elements; 3 consecutive unchanged readings = done
- Timeout at 30s; extract available messages + warning
- Short conversations (`scrollTop === 0`): bypass entirely, zero overhead

Implementation is confined to `GeminiExtractor` (private methods). No changes to `BaseExtractor`, `IConversationExtractor`, or `buildConversationResult()`.

---

## Alternatives Rejected

| Alternative                                 | Reason                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **MutationObserver**                        | Harder to test in jsdom, still needs timeout, no clear benefit over 1s polling            |
| **Incremental scrollBy()**                  | Unnecessary — single `scrollTo(0)` triggers full backfill                                 |
| **Network interception (batchexecute API)** | Fragile auth tokens, API instability, excessive complexity                                |
| **User notification only**                  | Pushes work to user; auto-scroll is automatic with graceful fallback                      |
| **Modify buildConversationResult()**        | Shared interface change for Gemini-specific concern; warning can be appended after return |

---

## Consequences

**Positive**: Long conversations fully extracted; zero overhead for short ones; graceful timeout with warning.

**Risks**: Scroll briefly visible to user; selector change degrades to pre-fix behavior (not a regression); 30s cap may not load extremely long conversations.

---

## References

- [gemini-chat-exporter](https://github.com/Louisjo/gemini-chat-exporter) — scroll-to-top approach reference
- Gemini scroll bug reports: [thread 1](https://support.google.com/gemini/thread/388320766), [thread 2](https://support.google.com/gemini/thread/349679299)
