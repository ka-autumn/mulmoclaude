<template>
  <div ref="containerEl" class="marp-container">
    <div class="flex items-center justify-end gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <span class="text-xs text-gray-500 mr-auto pl-2">{{ t("pluginMarkdown.marpSlidesMode", { count: slideCount }) }}</span>
      <button
        class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        :disabled="pdfDownloading"
        @click="onExportPdf"
      >
        <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
        {{ t("pluginMarkdown.marpExportPdf") }}
      </button>
      <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ t("pluginMarkdown.pdfFailedShort") }}</span>
    </div>
    <div v-if="renderError" class="load-error-banner" role="alert">
      {{ t("pluginMarkdown.marpRenderFailed", { error: renderError }) }}
    </div>
    <div class="marp-frame-wrapper">
      <div v-if="srcDoc" :style="{ height: frameHeight + 'px', overflow: 'hidden' }">
        <iframe
          :srcdoc="srcDoc"
          :style="{
            width: NATIVE_IFRAME_WIDTH + 'px',
            height: nativeContentHeight + 'px',
            transform: `scale(${slideScale})`,
            transformOrigin: 'top left',
          }"
          sandbox=""
          class="marp-frame"
          :title="t('pluginMarkdown.marpSlidesMode', { count: slideCount })"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { errorMessage } from "../../utils/errors";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";

const { t } = useI18n();

const props = defineProps<{
  markdown: string;
  pdfFilename: string;
  baseDir?: string;
}>();

const NATIVE_SLIDE_WIDTH = 1280;
const NATIVE_SLIDE_HEIGHT = 720;
const SLIDE_GAP_PX = 16;
const BODY_PADDING_PX = 16;
const WRAPPER_PADDING_PX = 12;
const NATIVE_IFRAME_WIDTH = NATIVE_SLIDE_WIDTH + BODY_PADDING_PX * 2;
const FALLBACK_WIDTH_PX = 800;

const containerEl = ref<HTMLElement | null>(null);
const containerWidth = ref(FALLBACK_WIDTH_PX);
const srcDoc = ref<string>("");
const slideCount = ref(0);
const renderError = ref<string | null>(null);

const { pdfDownloading, pdfError, downloadPdf } = usePdfDownload();

const slideScale = computed(() => (containerWidth.value - WRAPPER_PADDING_PX * 2) / NATIVE_IFRAME_WIDTH);

const nativeContentHeight = computed(() => {
  if (slideCount.value === 0) return BODY_PADDING_PX * 2;
  return slideCount.value * NATIVE_SLIDE_HEIGHT + Math.max(0, slideCount.value - 1) * SLIDE_GAP_PX + BODY_PADDING_PX * 2;
});

const frameHeight = computed(() => Math.ceil(nativeContentHeight.value * slideScale.value));

// Hard-locked CSP: defence-in-depth on top of `sandbox=""`. Even
// if the iframe boundary ever leaks (e.g. someone removes the empty
// sandbox attribute), the policy still blocks every network egress
// the slide could attempt — `connect-src 'none'` denies fetch /
// XHR / WebSocket / EventSource, and `frame-ancestors 'none'`
// prevents the iframe from being reframed by hostile content.
//
// `img-src` is pinned at runtime to the **parent app's origin** (plus
// `data:`). We can't use `'self'` here: `sandbox=""` srcdoc iframes
// have an opaque origin, and `'self'` resolves against that opaque
// origin (= matches nothing), which would block every workspace
// image including the legitimate `/artifacts/images/...` paths the
// rewriter produces. Pinning to `window.location.origin` lets the
// rewritten same-host URLs load while still denying every other host
// — a malicious deck can't craft `<img src="http://10.0.0.1/...">`
// SSRF probes or fetch external trackers. Style allows inline
// `<style>` blocks (Marp ships theme CSS inline). The `referrer`
// meta below keeps even the same-origin image fetches from leaking
// a referrer URL to the workspace file server.
function buildCsp(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const imgSrc = origin ? `${origin} data:` : "data:";
  return `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline' 'self'; font-src 'self' data:; connect-src 'none'; frame-ancestors 'none';`;
}

function buildSrcDoc(html: string, css: string): string {
  // Rendered with inlineSVG:false so Marp emits plain <section>
  // elements instead of SVG foreignObject wrappers. The theme CSS
  // sets each section to 1280×720. The parent scales the iframe
  // down with transform:scale() — no SVG scaling means no Safari bug.
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${buildCsp()}">
<meta name="referrer" content="no-referrer">
<style>
html,body { margin:0; padding:${BODY_PADDING_PX}px; background:transparent; }
${css}
div.marpit > section {
  display: block !important;
  margin: 0 auto ${SLIDE_GAP_PX}px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  border-radius: 6px;
}
</style></head><body>${html}</body></html>`;
}

function countSlides(html: string): number {
  const sectionMatches = html.match(/<section[\s>]/g);
  return sectionMatches ? sectionMatches.length : 0;
}

async function renderMarp(markdown: string): Promise<void> {
  renderError.value = null;
  if (!markdown) {
    srcDoc.value = "";
    slideCount.value = 0;
    return;
  }
  try {
    const { Marp } = await import("@marp-team/marp-core");
    const marp = new Marp({ inlineSVG: false, html: false });
    // Normalise `![alt](path)` refs BEFORE marp parses them — same
    // pre-pass the regular markdown renderer uses (wiki/View.vue,
    // FilesView.vue, markdown/View.vue). Without it, refs like
    // `../images/foo.png` resolve against `about:srcdoc` and 404.
    // Workspace-rooted refs route through `/artifacts/images` (static
    // mount) or `/api/files/raw` (authenticated route).
    const rewritten = rewriteMarkdownImageRefs(markdown, props.baseDir ?? "");
    const { html, css } = marp.render(rewritten);
    slideCount.value = countSlides(html);
    srcDoc.value = buildSrcDoc(html, css);
  } catch (err) {
    renderError.value = errorMessage(err);
    srcDoc.value = "";
    slideCount.value = 0;
  }
}

// Re-render whenever either the markdown OR the baseDir changes —
// `rewriteMarkdownImageRefs` resolves `../images/foo.png` against
// `baseDir`, so switching between two decks with the same body
// text but different file paths would otherwise reuse stale URLs
// (codex review). Pass `markdown` through verbatim; `renderMarp`
// already reads `props.baseDir` directly.
watch(
  () => [props.markdown, props.baseDir],
  ([source]) => {
    void renderMarp(source as string);
  },
  { immediate: true },
);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!containerEl.value) return;
  containerWidth.value = containerEl.value.clientWidth || FALLBACK_WIDTH_PX;
  resizeObserver = new ResizeObserver((entries) => {
    const [entry] = entries;
    if (entry) containerWidth.value = entry.contentRect.width || FALLBACK_WIDTH_PX;
  });
  resizeObserver.observe(containerEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

async function onExportPdf(): Promise<void> {
  if (!props.markdown) return;
  await downloadPdf(props.markdown, props.pdfFilename, { marp: true, baseDir: props.baseDir });
}
</script>

<style scoped>
.marp-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.marp-frame-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.marp-frame {
  border: none;
  background: transparent;
  display: block;
}

.load-error-banner {
  margin: 0.75rem 1rem;
  padding: 0.5rem 0.75rem;
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c2c7;
  border-radius: 4px;
  font-size: 0.875rem;
}
</style>
