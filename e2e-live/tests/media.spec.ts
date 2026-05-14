import { execSync } from "node:child_process";
import path from "node:path";

import { type Page, expect, test } from "@playwright/test";

import { TOOL_NAME as PRESENT_MULMO_SCRIPT_TOOL } from "../../src/plugins/presentMulmoScript/definition.ts";
import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { WORKSPACE_DIRS } from "../../server/workspace/paths.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeFixtureInWorkspace,
  readGeneratedImageNaturalSize,
  readGeneratedImageSrc,
  readImgNaturalSize,
  readImgRepairAttempted,
  readImgSrcInPresentHtml,
  readMovieDownload,
  readPdfDownload,
  removeFromWorkspace,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForGeneratedImage,
  waitForImgInPresentHtml,
} from "../fixtures/live-chat.ts";

const L01_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L02_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
// L-03 has to absorb both the LLM authoring the script and the
// server-side TTS + ffmpeg compose. 2-beat scripts in practice
// finish in a couple of minutes; the 10-minute ceiling leaves
// headroom for the slowest TTS provider on a cold cache.
const L03_TIMEOUT_MS = 10 * ONE_MINUTE_MS;
const L03_GENERATION_TIMEOUT_MS = 8 * ONE_MINUTE_MS;
// L-04 (animation:true) compose is per-frame Puppeteer screenshot
// + ffmpeg encode. A 1-beat / 2-second / 30fps fixture is ~60
// frames; in practice it lands in 30–90s, so the ceilings here are
// the same order as L-03 with a little extra slack for cold-cache
// browser launches.
const L04_TIMEOUT_MS = 8 * ONE_MINUTE_MS;
const L04_GENERATION_TIMEOUT_MS = 6 * ONE_MINUTE_MS;
// Disk path constant + matching wire-form prefix for mulmoScript
// fixtures. WORKSPACE_DIRS.stories is the canonical disk location
// ("artifacts/stories" on host, exposed by server/workspace/paths.ts),
// and the wire form passed to the LLM keeps the leading "stories/"
// prefix that the server's resolveStoryPath strips before resolving
// against artifacts/stories/. The wire prefix is server-internal
// (server/api/routes/mulmo-script.ts:42-50, no exported constant
// today), so it's pinned here against the disk constant by stripping
// the `artifacts/` prefix — if `WORKSPACE_DIRS.stories` ever stops
// starting with `artifacts/`, the throw below trips at module load
// and the suite fails fast instead of silently shipping the wrong
// wire prefix to the LLM (codex iter-3: a regex `replace` would
// otherwise no-op on miss and pass `artifacts/data/foo.json` etc.
// straight through).
const STORIES_DISK_PREFIX = "artifacts/";
const STORIES_DISK_DIR = WORKSPACE_DIRS.stories;
if (!STORIES_DISK_DIR.startsWith(STORIES_DISK_PREFIX)) {
  throw new Error(`WORKSPACE_DIRS.stories must start with "${STORIES_DISK_PREFIX}" to derive the wire-form prefix; got ${JSON.stringify(STORIES_DISK_DIR)}`);
}
const STORIES_WIRE_DIR = STORIES_DISK_DIR.slice(STORIES_DISK_PREFIX.length);
// L-05 has to absorb the LLM picking the generateImage tool plus the
// Gemini image-gen round trip. Cold Gemini calls land in 30–60s in
// practice; 4 minutes leaves slack for slow networks without inviting
// a hung run to soak up the wall clock.
const L05_TIMEOUT_MS = 4 * ONE_MINUTE_MS;
const L05_IMAGE_VISIBLE_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
// Floor for "the route returned a real PDF, not a stub". The actual
// size depends on how verbose the LLM's reply happens to be that
// run, so this is loose on purpose — `readPdfDownload` already
// asserts the %PDF- magic bytes plus %%EOF tail, this number just
// keeps obviously empty stubs out.
const MIN_PDF_BYTES = 500;
// Same idea for the movie: `readMovieDownload` already validates
// the MP4 `ftyp` marker, so we just need a floor that excludes
// truncated stubs. 1 KiB is well below any real 2-beat output.
const MIN_MOVIE_BYTES = 1024;

const L01_IMG_ALT = "sample";
const L01_IMG_LOCATOR = `img[alt="${L01_IMG_ALT}"]`;

// Each scenario opens its own chat session, so they do not share
// state. Run them in parallel to cut wall time — the server happily
// services multiple chat sessions concurrently (verified by hand
// before turning this on).
test.describe.configure({ mode: "parallel" });

test.describe("media (real LLM)", () => {
  test("L-01: presentHtml の <img src='../../../images/...'> が /artifacts/html 経由で描画される", async ({ page }) => {
    // Needs presentHtml server-side handler to land the html artifact.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs server-side presentHtml dispatch");
    test.setTimeout(L01_TIMEOUT_MS);
    // Spec-unique flat path — see comment in seedL01Fixture.
    const workspaceImageRel = "artifacts/images/e2e-live-l01.png";
    await seedL01Fixture(workspaceImageRel);
    try {
      await startNewSession(page);
      await sendL01Prompt(page, workspaceImageRel);
      await assertL01PresentHtml(page);
      await waitForAssistantResponseComplete(page);
    } finally {
      await cleanupSessionAndWorkspace(page, workspaceImageRel);
    }
  });

  test("L-02: 画像参照を含む Markdown 応答が PDF として DL できる", async ({ page }) => {
    // Fake-echo's history-join echoes the entire user prompt as the
    // assistant body, which the PDF generator stumbles on. Real
    // Claude omits the preamble per instruction.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs LLM-trimmed markdown body");
    test.setTimeout(L02_TIMEOUT_MS);
    // Seeding the image makes B-19 / B-20 actually exercisable —
    // without it, /api/pdf/markdown can return a "PDF with broken
    // image" that still passes magic-bytes + size checks.
    const workspaceImageRel = "artifacts/images/e2e-live-l02.png";
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
    try {
      await startNewSession(page);
      await sendL02Prompt(page, workspaceImageRel);
      await waitForAssistantResponseComplete(page);
      await downloadAndAssertPdf(page);
    } finally {
      await cleanupSessionAndWorkspace(page, workspaceImageRel);
    }
  });

  test("L-05: generateImage プラグインで実画像が描画される", async ({ page }) => {
    // Needs a real GEMINI_API_KEY + image-generation tool dispatch.
    // fake-echo can't synthesize the image bytes.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs Gemini image generation");
    test.setTimeout(L05_TIMEOUT_MS);
    // Pure Gemini-side path — no fixture seeding needed. The server's
    // /api/image/generate-image route saves the result under
    // ~/mulmoclaude/artifacts/images/<YYYY>/<MM>/<id>.png and
    // returns `data.imageData` as the workspace-relative path; the
    // SPA's resolveImageSrcFresh maps that to /artifacts/images/...
    // via the static mount (PR #969 / #972 / #983).
    //
    // GEMINI_API_KEY must be configured server-side (.env or shell
    // for `yarn dev`). Without it the route returns no imageData and
    // ImageView stays on the placeholder, so the visibility wait
    // fails cleanly with a meaningful timeout. We deliberately do
    // not skip on `process.env.GEMINI_API_KEY` here because the test
    // process lives in a different env from `yarn dev` — the dev
    // shell loads .env via dotenv, but the spec runner does not.
    try {
      await startNewSession(page);
      await sendL05Prompt(page);
      await assertL05GeneratedImage(page);
      await waitForAssistantResponseComplete(page);
    } finally {
      const sessionId = getCurrentSessionId(page);
      if (sessionId) await deleteSession(page, sessionId);
    }
  });

  test("L-04: animation:true の mulmoScript → 動画生成がエラーなく完走する", async ({ page }, testInfo) => {
    // ffmpeg + Gemini both required. Out of scope for fake-echo.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs ffmpeg + Gemini");
    test.setTimeout(L04_TIMEOUT_MS);
    // Same ffmpeg precondition as L-03 — mulmocast shells out to
    // system ffmpeg via fluent-ffmpeg for the per-frame compose
    // step, so without ffmpeg on PATH the test would silently hang
    // on the 6-minute generation timeout instead of skipping cleanly.
    test.skip(!isFFmpegAvailable(), "ffmpeg not in PATH; required for the mulmoScript animation compose pipeline (see issue #1049)");
    // L-04 covers B-46 — `animation: true` on an html_tailwind beat
    // used to break the movie compose path. We seed a fixture with
    // exactly one short animated beat (text="" so TTS stays out of
    // the picture, no GEMINI_API_KEY required) and drive the same
    // Generate → Download UI flow as L-03; B-46 manifests as the
    // Download Movie button never appearing.
    //
    // Project-name suffix mirrors L-03's race guard against the
    // server's `inFlightMovies` set — keeps chromium / webkit from
    // contending on the same fixture path during parallel runs.
    const slug = testInfo.project.name;
    const fixtureBasename = `e2e-live-l04-${slug}.json`;
    const workspaceScriptRel = path.posix.join(STORIES_DISK_DIR, fixtureBasename);
    const wireFilePath = path.posix.join(STORIES_WIRE_DIR, fixtureBasename);
    await placeFixtureInWorkspace("mulmo/l04-animation.json", workspaceScriptRel);
    try {
      await startNewSession(page);
      await sendMulmoFilePathPrompt(page, wireFilePath);
      await waitForMulmoScriptViewReady(page);
      await waitForAssistantResponseComplete(page);
      await generateAndDownloadMovieWithTimeout(page, L04_GENERATION_TIMEOUT_MS);
    } finally {
      const sessionId = getCurrentSessionId(page);
      if (sessionId) await deleteSession(page, sessionId);
      await removeFromWorkspace(workspaceScriptRel);
    }
  });

  test("L-03: 既存 mulmoScript → 動画生成 → 動画 DL が成功する", async ({ page }, testInfo) => {
    // Needs system ffmpeg. Out of scope for fake-echo.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs ffmpeg");
    test.setTimeout(L03_TIMEOUT_MS);
    // mulmocast spawns system ffmpeg via fluent-ffmpeg (not bundled).
    // Without it, movie compose fails silently and the test times
    // out at the 8-minute mark. Skip with a loud reason instead so
    // teammates know to install ffmpeg locally — see issue #1049
    // for the matching docs gap on the user-facing side.
    test.skip(!isFFmpegAvailable(), "ffmpeg not in PATH; required for the mulmoScript movie compose pipeline (see issue #1049)");
    // L-03 is scoped to B-21 (download-movie bearer-auth flow). To
    // remove LLM-script-authoring drift and skip TTS / image-gen
    // APIs entirely, we seed a pre-built mulmoScript fixture and
    // ask the LLM only to re-display it via filePath mode. Empty
    // beat `text` plus textSlide images means: no API calls, no
    // GEMINI key needed, just ffmpeg locally composing two short
    // silent slides.
    //
    // Disk lives under artifacts/stories/ (WORKSPACE_DIRS.stories);
    // the wire form passed to the LLM keeps the canonical
    // "stories/<file>" prefix that the server's resolveStoryPath
    // strips before resolving against artifacts/stories/.
    //
    // Suffixing the filename with the Playwright project name
    // keeps chromium and webkit from contending for the same
    // absoluteFilePath inside server's inFlightMovies guard —
    // without this they race and only one worker's generateMovie
    // SSE stream completes (the loser hangs for the full timeout).
    const slug = testInfo.project.name;
    const fixtureBasename = `e2e-live-l03-${slug}.json`;
    // path.posix.join keeps the separator forward-slash on every
    // host so the wire form matches the server's POSIX-shaped
    // resolveStoryPath input regardless of the runner OS.
    const workspaceScriptRel = path.posix.join(STORIES_DISK_DIR, fixtureBasename);
    const wireFilePath = path.posix.join(STORIES_WIRE_DIR, fixtureBasename);
    await placeFixtureInWorkspace("mulmo/l03-two-beat.json", workspaceScriptRel);
    try {
      await startNewSession(page);
      await sendMulmoFilePathPrompt(page, wireFilePath);
      await waitForMulmoScriptViewReady(page);
      await waitForAssistantResponseComplete(page);
      await generateAndDownloadMovieWithTimeout(page, L03_GENERATION_TIMEOUT_MS);
    } finally {
      const sessionId = getCurrentSessionId(page);
      if (sessionId) await deleteSession(page, sessionId);
      await removeFromWorkspace(workspaceScriptRel);
    }
  });
});

/**
 * Place the fixture image at a flat `artifacts/images/<file>` path.
 * Flat (no YYYY/MM shard) is what makes `../../../images/<file>`
 * correct from the saved `artifacts/html/<YYYY>/<MM>/page.html`. If
 * presentHtml's save depth ever changes, the relative path in the
 * prompt below has to shift in lock step.
 */
async function seedL01Fixture(workspaceImageRel: string): Promise<void> {
  await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
}

async function sendL01Prompt(page: Page, workspaceImageRel: string): Promise<void> {
  // Filename only — the relative-path prefix below pulls the LLM
  // toward the convention introduced in PR #982.
  const filename = workspaceImageRel.split("/").pop() ?? "";
  const message = [
    "以下の HTML を presentHtml ツールでそのまま表示してください。",
    "",
    "<h1>e2e-live L-01 test</h1>",
    `<img src="../../../images/${filename}" alt="${L01_IMG_ALT}" />`,
  ].join("\n");
  await sendChatMessage(page, message);
}

/**
 * Verify that the rendered iframe contains the image, that the LLM
 * kept the relative-path convention from PR #982, and that the
 * mount + path-traversal guard chain actually serves the file
 * (`naturalWidth > 0` is the end-to-end signal — B-18's failure
 * mode is `naturalWidth = 0`).
 */
async function assertL01PresentHtml(page: Page): Promise<void> {
  await waitForImgInPresentHtml(page, L01_IMG_LOCATOR);
  const src = await readImgSrcInPresentHtml(page, L01_IMG_LOCATOR);
  if (src === null) {
    throw new Error(`presentHtml iframe should contain ${L01_IMG_LOCATOR}`);
  }
  expect(src).toContain("e2e-live-l01.png");
  expect(src, "the LLM must follow the relative-path convention from PR #982").not.toMatch(/^\/artifacts\//);
  const size = await readImgNaturalSize(page, L01_IMG_LOCATOR);
  if (size === null) {
    throw new Error("naturalSize should be readable");
  }
  expect(size.width, "image must actually decode (B-18 regression)").toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
  await assertL01NoSelfRepair(page);
}

/**
 * PR #974's onerror self-repair would otherwise mask an LLM
 * regression that embeds `artifacts/images/...` behind a wrong
 * prefix — the browser rewrites the src to `/artifacts/images/<rest>`,
 * the image loads, naturalWidth > 0, and the convention drift goes
 * unnoticed. The repair script tags the element on activation, so
 * an unset marker means the original src was already correct.
 */
async function assertL01NoSelfRepair(page: Page): Promise<void> {
  const repaired = await readImgRepairAttempted(page, L01_IMG_LOCATOR);
  expect(repaired, "self-repair must not fire — LLM regressed from the relative-path convention").toBe(false);
}

async function sendL02Prompt(page: Page, workspaceImageRel: string): Promise<void> {
  // textResponse plugin's PDF download route inlines images on the
  // server (B-19 / B-20 fix). Pointing the markdown at the seeded
  // workspace path is what exercises that inline path end-to-end.
  const absPath = `/${workspaceImageRel}`;
  const message = [
    "次の Markdown を **そのまま** 1 ターンの返信本文として返してください。",
    "ツールは何も呼ばないでください。前置きや締めの一文も付けないでください。",
    "",
    "# L-02 PDF DL test",
    "",
    `![sample](${absPath})`,
    "",
    "本文サンプル。",
  ].join("\n");
  await sendChatMessage(page, message);
}

async function downloadAndAssertPdf(page: Page): Promise<void> {
  const pdfBtn = page.getByTestId("text-response-pdf-button").first();
  await expect(pdfBtn).toBeVisible({ timeout: ONE_MINUTE_MS });
  const downloadPromise = page.waitForEvent("download");
  await pdfBtn.click();
  const pdf = await readPdfDownload(await downloadPromise);
  expect(pdf.length, "PDF should not be a near-empty stub").toBeGreaterThan(MIN_PDF_BYTES);
}

/**
 * Ask the LLM to re-display the seeded mulmoScript via filePath.
 * Reduces script-authoring drift to "the LLM picked the right tool
 * and passed one argument" — both of which are reliable. The
 * fixture itself controls beats / TTS / image type.
 */
async function sendMulmoFilePathPrompt(page: Page, wireFilePath: string): Promise<void> {
  const message = [
    `\`${PRESENT_MULMO_SCRIPT_TOOL}\` ツールに \`filePath: "${wireFilePath}"\` を渡して、 既存スクリプトをそのまま表示してください。`,
    "",
    "- ツールには filePath だけを渡し、 script は省略してください",
    "- 動画生成 (Generate Movie / generateMovie ツール) は呼ばないでください — テスト側でボタンを押します",
  ].join("\n");
  await sendChatMessage(page, message);
}

/**
 * mulmocast's video pipeline shells out to system ffmpeg via
 * fluent-ffmpeg, so the host needs ffmpeg on PATH. We probe with
 * `which ffmpeg` and skip the test cleanly when it's missing.
 */
function isFFmpegAvailable(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until presentMulmoScript has rendered the script panel with
 * no movie attached yet — that's the moment the Generate Movie pill
 * becomes the visible action. If the LLM refuses to call the tool
 * and just drops markdown, this never appears and the test fails
 * cleanly on the timeout instead of misleading downstream errors.
 */
async function waitForMulmoScriptViewReady(page: Page): Promise<void> {
  await expect(page.getByTestId("mulmo-script-generate-movie-button").first()).toBeVisible({ timeout: ONE_MINUTE_MS });
}

/**
 * Drive the Generate → Download flow end-to-end. The Download pill
 * only appears once the server has finished compose, so its
 * visibility doubles as a "generation complete" signal. Caller
 * supplies the generation timeout because L-03 (TTS + textSlide
 * compose) and L-04 (per-frame animation compose) have different
 * cost profiles.
 */
async function generateAndDownloadMovieWithTimeout(page: Page, generationTimeoutMs: number): Promise<void> {
  await page.getByTestId("mulmo-script-generate-movie-button").first().click();
  const downloadBtn = page.getByTestId("mulmo-script-download-movie-button").first();
  await expect(downloadBtn).toBeVisible({ timeout: generationTimeoutMs });
  const downloadPromise = page.waitForEvent("download");
  await downloadBtn.click();
  const movie = await readMovieDownload(await downloadPromise);
  expect(movie.length, "movie should not be a near-empty stub").toBeGreaterThan(MIN_MOVIE_BYTES);
}

/**
 * Push the LLM toward the generateImage tool (vs returning a text
 * description). The "ツールを使ってください — 文章での描写ではなく実画像が必要です"
 * line is what flips Claude away from offering ASCII art / verbal
 * descriptions when the prompt is ambiguous. Subject is intentionally
 * mundane to keep generation fast and avoid Gemini's safety triggers.
 */
async function sendL05Prompt(page: Page): Promise<void> {
  const message = [
    "猫が窓辺で日向ぼっこしているシンプルなイラストを 1 枚生成してください。",
    "generateImage ツールを使ってください — 文章での描写ではなく実画像が必要です。",
  ].join("\n");
  await sendChatMessage(page, message);
}

/**
 * End-to-end signal that generateImage worked: the SPA mounted the
 * canvas view, the resolved src points at the static mount, and the
 * browser actually decoded the file. `naturalWidth > 0` is the
 * decisive bit — a 404 / wrong MIME / empty file all fail there.
 */
async function assertL05GeneratedImage(page: Page): Promise<void> {
  await waitForGeneratedImage(page, L05_IMAGE_VISIBLE_TIMEOUT_MS);
  const src = await readGeneratedImageSrc(page);
  if (src === null) {
    throw new Error("generateImage view should contain an <img>");
  }
  // resolveImageSrcFresh maps `artifacts/images/...` paths to
  // `/artifacts/images/...?v=<bump>`, so the leading slash + prefix
  // is the marker that the static-mount routing chain stayed intact.
  expect(src, "image src should resolve via the artifacts/images static mount").toMatch(/^\/artifacts\/images\//);
  // naturalWidth/Height race the decode — wait until the browser
  // has actually loaded the bytes before asserting.
  await expect(async () => {
    const size = await readGeneratedImageNaturalSize(page);
    if (size === null) {
      throw new Error("generateImage <img> disappeared before naturalSize could be read");
    }
    expect(size.width, "image must actually decode").toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  }).toPass({ timeout: ONE_MINUTE_MS });
}

/**
 * Best-effort teardown — never throws. Removes the session from
 * history (so the user's chat list isn't littered with debug runs)
 * and deletes the seeded fixture file.
 */
async function cleanupSessionAndWorkspace(page: Page, workspaceImageRel: string): Promise<void> {
  const sessionId = getCurrentSessionId(page);
  if (sessionId) await deleteSession(page, sessionId);
  await removeFromWorkspace(workspaceImageRel);
}
