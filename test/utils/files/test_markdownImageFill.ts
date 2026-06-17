import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImagePlaceholderReplacement, fillImagePlaceholders } from "@mulmoclaude/markdown-plugin";
import { IMAGE_PLACEHOLDER } from "../../../server/utils/files/markdown-image-fill.js";

describe("buildImagePlaceholderReplacement", () => {
  describe("ref present — used verbatim as the image URL", () => {
    it("emits the alt text + the host-resolved ref unchanged", () => {
      // The host (generateImageFile) returns a workspace-rooted "/…" ref;
      // a leading `/` lets a document shard under
      // `artifacts/documents/YYYY/MM/` reach an image under
      // `artifacts/images/YYYY/MM/` regardless of nesting depth.
      assert.equal(
        buildImagePlaceholderReplacement("sunset over kyoto", "/artifacts/images/2026/04/x.png"),
        "![sunset over kyoto](/artifacts/images/2026/04/x.png)",
      );
    });

    it("passes prompt text through as alt text unchanged (spaces / punctuation preserved)", () => {
      assert.equal(
        buildImagePlaceholderReplacement("A dog, sitting on a rug (hyper-detailed)", "/artifacts/images/2026/04/y.png"),
        "![A dog, sitting on a rug (hyper-detailed)](/artifacts/images/2026/04/y.png)",
      );
    });

    it("passes non-ASCII prompt text through unchanged", () => {
      assert.equal(buildImagePlaceholderReplacement("夕焼けの京都", "/artifacts/images/2026/04/z.png"), "![夕焼けの京都](/artifacts/images/2026/04/z.png)");
    });

    it("uses the ref verbatim (no slash munging) — supports data URIs for other hosts", () => {
      // Host-agnostic: MulmoTerminal can pass a `data:` URI here and it
      // must NOT be mangled with a leading slash.
      assert.equal(buildImagePlaceholderReplacement("test", "data:image/png;base64,AAA"), "![test](data:image/png;base64,AAA)");
    });
  });

  describe("ref null — text fallback", () => {
    it("renders an italic image marker when generation skipped or failed", () => {
      // When `GEMINI_API_KEY` is missing OR generation threw,
      // the placeholder falls through to a visible marker so the
      // document still renders without broken image refs. The
      // 🖼️ glyph makes the fallback obvious to operators reading
      // the rendered markdown.
      assert.equal(buildImagePlaceholderReplacement("sunset over kyoto", null), "*🖼️ Image: sunset over kyoto*");
    });

    it("preserves non-ASCII prompt text in the fallback", () => {
      assert.equal(buildImagePlaceholderReplacement("夕焼けの京都", null), "*🖼️ Image: 夕焼けの京都*");
    });

    it("preserves empty prompt text (edge case — markdown still renders)", () => {
      assert.equal(buildImagePlaceholderReplacement("", null), "*🖼️ Image: *");
    });
  });
});

describe("IMAGE_PLACEHOLDER regex", () => {
  function findAll(markdown: string): string[] {
    return [...markdown.matchAll(IMAGE_PLACEHOLDER)].map((match) => match[1]);
  }

  it("matches the plain form `![alt](__too_be_replaced_image_path__)`", () => {
    assert.deepEqual(findAll("See ![sunset](__too_be_replaced_image_path__) here."), ["sunset"]);
  });

  it("matches the leading-slash variant `![alt](/__too_be_replaced_image_path__)`", () => {
    // Some agents emit the placeholder with a leading slash; both
    // forms must be caught.
    assert.deepEqual(findAll("See ![sunset](/__too_be_replaced_image_path__) here."), ["sunset"]);
  });

  it("captures multiple placeholders in one document", () => {
    const input = [
      "![first](__too_be_replaced_image_path__)",
      "intervening text",
      "![second](__too_be_replaced_image_path__)",
      "![third](/__too_be_replaced_image_path__)",
    ].join("\n");
    assert.deepEqual(findAll(input), ["first", "second", "third"]);
  });

  it("does NOT match real image references that happen to have an alt text", () => {
    // Already-filled references (with an actual path) must pass
    // through untouched — otherwise a second run would corrupt
    // previously generated documents.
    assert.deepEqual(findAll("![alt](/artifacts/images/foo.png)"), []);
    assert.deepEqual(findAll("![alt](https://example.com/foo.png)"), []);
  });

  it("preserves non-ASCII alt text", () => {
    assert.deepEqual(findAll("![夕焼けの京都](__too_be_replaced_image_path__)"), ["夕焼けの京都"]);
  });

  it("does not match if the alt text is missing (empty `[]` not captured)", () => {
    assert.deepEqual(findAll("![](__too_be_replaced_image_path__)"), []);
  });
});

describe("fillImagePlaceholders — plain vs Marp directive (title) forms", () => {
  it("plain: generates from the alt and keeps it as the alt", async () => {
    const prompts: string[] = [];
    const { markdown } = await fillImagePlaceholders("![A sunset over Kyoto](__too_be_replaced_image_path__)", {
      resolveImage: async (prompt) => {
        prompts.push(prompt);
        return "https://img/0.png";
      },
    });
    assert.deepEqual(prompts, ["A sunset over Kyoto"]);
    assert.equal(markdown, "![A sunset over Kyoto](https://img/0.png)");
  });

  it("Marp: generates from the TITLE and preserves the directive in the alt", async () => {
    const prompts: string[] = [];
    const { markdown } = await fillImagePlaceholders('![bg right:45%](__too_be_replaced_image_path__ "A Tokyo skyline at golden hour")', {
      resolveImage: async (prompt) => {
        prompts.push(prompt);
        return "data:image/png;base64,AAA";
      },
    });
    assert.deepEqual(prompts, ["A Tokyo skyline at golden hour"]);
    assert.equal(markdown, "![bg right:45%](data:image/png;base64,AAA)");
  });

  it("Marp null fallback shows the prompt (title), not the directive", async () => {
    const { markdown } = await fillImagePlaceholders('![bg left:45%](__too_be_replaced_image_path__ "A temple in Asakusa")', {
      resolveImage: async () => null,
    });
    assert.equal(markdown, "*🖼️ Image: A temple in Asakusa*");
  });

  it("Marp directive WITHOUT a title generates no image (contract: title required)", async () => {
    let called = 0;
    const { markdown } = await fillImagePlaceholders("![bg right:45%](__too_be_replaced_image_path__)", {
      resolveImage: async () => {
        called++;
        return "https://img/should-not-happen.png";
      },
    });
    assert.equal(called, 0, "resolveImage must not run for a directive alt without a title");
    assert.equal(markdown, "*🖼️ Image: bg right:45%*");
  });

  it("accepts escaped quotes inside the title prompt", async () => {
    const prompts: string[] = [];
    const { markdown } = await fillImagePlaceholders('![bg](__too_be_replaced_image_path__ "A sign reading \\"AI\\"")', {
      resolveImage: async (prompt) => {
        prompts.push(prompt);
        return "https://img/0.png";
      },
    });
    // The regex must match (no silent skip), and the prompt is unescaped.
    assert.deepEqual(prompts, ['A sign reading "AI"']);
    assert.equal(markdown, "![bg](https://img/0.png)");
  });

  it("handles a mix of plain + Marp placeholders in document order", async () => {
    const source = ["![plain prompt](__too_be_replaced_image_path__)", '![bg right:45%](__too_be_replaced_image_path__ "marp prompt")'].join("\n\n");
    let i = 0;
    const { markdown } = await fillImagePlaceholders(source, { resolveImage: async () => `https://img/${i++}.png` });
    assert.equal(markdown, ["![plain prompt](https://img/0.png)", "![bg right:45%](https://img/1.png)"].join("\n\n"));
  });
});
