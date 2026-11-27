import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { resolveExtractionTarget } from "../src/extraction-target";

function fixture(html: string) {
    const window = new Window();
    const container = window.document.createElement("div");
    container.innerHTML = html;
    // happy-dom はブラウザーと同じ DOM API を提供します。
    return container as unknown as HTMLElement;
}
const text = "```ts\nconst x = 1;\n```";
const context = {
    getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 2 }),
};

test("native, Mermaid and unknown exact-section renderers resolve original source", () => {
    for (const html of [
        "<pre><code><span>highlight</span></code></pre>",
        '<div class="mermaid"><svg><text>graph</text></svg></div>',
        '<div class="custom-renderer"><span>custom</span></div>',
    ]) {
        const container = fixture(html);
        const result = resolveExtractionTarget(
            container.querySelector("span, text")!,
            container,
            context,
        );
        assert.equal(result?.fence.code, "const x = 1;\n");
    }
});

test("Expressive Code title, line number and replaced content retain source mapping", () => {
    const container = fixture(
        '<div class="expressive-code"><figure><figcaption>title.ts</figcaption><pre><code><span class="line-number">1</span><span>highlight</span></code></pre></figure></div>',
    );
    for (const target of Array.from(
        container.querySelectorAll("figcaption, span"),
    )) {
        assert.equal(
            resolveExtractionTarget(target, container, context)?.fence.raw,
            text,
        );
    }
    container.firstElementChild!.innerHTML =
        "<header>new title</header><pre><code>new DOM</code></pre>";
    assert.equal(
        resolveExtractionTarget(
            container.querySelector("header")!,
            container,
            context,
        )?.text,
        text,
    );
});

test("identical adjacent blocks use individual sections and ambiguous mappings are rejected", () => {
    const container = fixture(
        "<pre><code>same</code></pre><pre><code>same</code></pre>",
    );
    const source = text + "\n" + text;
    const blocks = Array.from(container.querySelectorAll("pre"));
    const scoped = {
        getSectionInfo(element: HTMLElement) {
            const index = blocks.indexOf(element.closest("pre")!);
            return {
                text: source,
                lineStart: index === 1 ? 3 : 0,
                lineEnd: index === 1 ? 5 : 2,
            };
        },
    };
    assert.equal(
        resolveExtractionTarget(blocks[1].firstElementChild!, container, scoped)
            ?.fence.lineStart,
        3,
    );
    assert.equal(
        resolveExtractionTarget(blocks[0], container, {
            getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: 5 }),
        }),
        null,
    );
});

test("paragraphs, inline code, embeds, missing mappings and foreign containers are ignored", () => {
    const container = fixture(
        '<p>paragraph <code>inline</code></p><div class="code-embed"><pre>embedded</pre></div>',
    );
    const broad = {
        getSectionInfo: () => ({
            text: "paragraph\n" + text,
            lineStart: 0,
            lineEnd: 3,
        }),
    };
    for (const target of Array.from(
        container.querySelectorAll("p, p code, pre"),
    )) {
        assert.equal(resolveExtractionTarget(target, container, broad), null);
    }
    assert.equal(
        resolveExtractionTarget(container, container, {
            getSectionInfo: () => null,
        }),
        null,
    );
    assert.equal(
        resolveExtractionTarget(
            fixture("<pre>other</pre>"),
            container,
            context,
        ),
        null,
    );
});
