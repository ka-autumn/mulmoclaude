import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, sendChatMessage, startGuaranteedNewSession, waitForAssistantResponseComplete } from "../fixtures/live-chat.ts";

const L_ERR_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// Batch 3: the agent-error → chat-banner UI path. When the backend
// yields an `error` AgentEvent, the SSE consumer maps it through
// `pushErrorMessage` (src/utils/agent/eventDispatch.ts → session
// helpers) into a `text-response` card prefixed with `[Error] `.
// Before the fake-echo seam this needed a crashed Claude
// subprocess to reproduce; now the spec opts in with the
// `__FAKE_ERROR__` marker, which fake-echo's defaultResponse turns
// into a forced error event (prod never reaches fake-echo).
test.describe("agent error banner (fake-echo forced error)", () => {
  test("L-ERR: backend error event renders as an [Error] text card and the turn ends", async ({ page }) => {
    // This canary drives the forced-error branch via the
    // `__FAKE_ERROR__` marker, which is implemented only in
    // `server/agent/backend/fake-echo.ts`'s `defaultResponse` —
    // there is no equivalent shortcut in the real-Claude backend.
    // The matching CI job (`.github/workflows/e2e_live_no_llm.yaml`,
    // `error-banner` matrix entry) boots the dev server with
    // `MULMOCLAUDE_FAKE_AGENT=1` and sets `E2E_LIVE_NO_LLM=1` on the
    // test process; gate on that env var so local `yarn test:e2e:live`
    // runs (real Claude backend, where the marker has no meaning and
    // the model politely refuses) skip the spec instead of asserting
    // against a fake-echo-only error string.
    test.skip(process.env.E2E_LIVE_NO_LLM !== "1", "L-ERR exercises fake-echo's `__FAKE_ERROR__` branch; the real-Claude backend has no equivalent trigger");
    test.setTimeout(L_ERR_TIMEOUT_MS);
    let sessionIdForCleanup: string | null = null;
    try {
      // Use startGuaranteedNewSession (not startNewSession) to dodge
      // the SPA's bootstrap-resume race: page.goto("/") can land on
      // /chat/<existing>, and if that session has an in-flight turn
      // sendChatMessage hits POST /api/agent and gets 409 "Session
      // is already running" — which then renders as the *wrong*
      // [Error] card and the assertion on the fake-echo error
      // message fails. The guarded variant baselines the server's
      // existing session ids before clicking and only resolves once
      // the URL settles on a brand-new id (#1345).
      sessionIdForCleanup = await startGuaranteedNewSession(page);

      // The marker drives fake-echo's forced-error branch. We embed
      // it in an otherwise normal sentence so the detector's
      // substring check (not a strict-equality match) is exercised.
      await sendChatMessage(page, "please trigger __FAKE_ERROR__ now");

      // pushErrorMessage builds a `text-response` ToolResult with
      // title "Error" and body `[Error] <message>`, and selects it,
      // so the assistant body surface must show the prefix.
      const assistantBody = page.getByTestId("text-response-assistant-body").last();
      await expect(assistantBody, "the forced backend error must render as an assistant [Error] card").toContainText("[Error]", {
        timeout: ONE_MINUTE_MS,
      });
      // Assert on a markdown-safe substring of fake-echo's error
      // string (the `__FAKE_ERROR__` trigger itself would be eaten
      // by marked() as bold emphasis, so don't assert on it).
      await expect(assistantBody, "the error card must carry the fake-echo error message").toContainText(
        "fake-echo forced error for the e2e-live error-banner canary",
        {
          timeout: ONE_MINUTE_MS,
        },
      );

      // The turn must still complete — endRun fires in the
      // consumer's finally even on the error path, so the thinking
      // indicator clears (no perpetual spinner).
      await waitForAssistantResponseComplete(page, L_ERR_TIMEOUT_MS);
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });
});
