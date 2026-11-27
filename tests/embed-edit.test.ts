import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Window } from "happy-dom";

test("reading edit selects the clicked repeated embed and rejects changed notes", async () => {
    const bundle = await build({
        entryPoints: ["src/embed.ts"],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        plugins: [
            {
                name: "host",
                setup(b) {
                    b.onResolve({ filter: /^obsidian$/ }, () => ({
                        path: "obsidian",
                        namespace: "stub",
                    }));
                    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
                        contents: `
                export class MarkdownRenderChild { constructor(container) { this.containerEl = container; } }
                export class MarkdownView {}
                export class PluginSettingTab {} export class Setting {} export class AbstractInputSuggest {}
                export class TFile {} export class TFolder {} export class Notice {}
                export function loadPrism() {} export function setIcon() {} export function setTooltip() {}
                export const Platform = {};
            `,
                    }));
                },
            },
        ],
    });
    const source = bundle.outputFiles[0].text + "\nexport { MarkdownView };";
    const { processReadingEmbeds, MarkdownView } = await import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    const window = new Window();
    const globals = globalThis as any;
    const previous = globals.document;
    globals.document = window.document;
    try {
        const container = window.document.createElement("div");
        container.innerHTML =
            '<span class="internal-embed" src="a.ts"></span><span class="internal-embed" src="a.ts"></span>';
        const text = "prefix\n![[a.ts]] and ![[a.ts|label]]\n";
        let current = text;
        let switches = 0;
        let selection: number[] = [];
        let focused = false;
        const view = Object.assign(new MarkdownView(), {
            file: { path: "note.md" },
            containerEl: container,
            getViewData: () => current,
            getState: () => ({ file: "note.md" }),
            leaf: {
                async setViewState(state: any) {
                    assert.equal(state.state.mode, "source");
                    switches++;
                },
            },
            editor: {
                getValue: () => current,
                offsetToPos: (offset: number) => offset,
                setSelection: (from: number, to: number) => {
                    selection = [from, to];
                },
                scrollIntoView() {},
                focus() {
                    focused = true;
                },
            },
        });
        const children: any[] = [];
        processReadingEmbeds(
            {
                settings: { enabled: true, extensions: "ts" },
                app: { workspace: { getLeavesOfType: () => [{ view }] } },
            },
            container,
            {
                sourcePath: "note.md",
                getSectionInfo: () => ({ text, lineStart: 1, lineEnd: 1 }),
                addChild: (child: any) => children.push(child),
            },
        );
        assert.equal(children.length, 2);
        await children[1].onEdit();
        assert.equal(
            text.slice(...(selection as [number, number])),
            "a.ts|label",
        );
        assert.equal(focused, true);
        await children[0].onEdit();
        assert.equal(text.slice(...(selection as [number, number])), "a.ts");
        current = "changed" + text;
        await assert.rejects(children[1].onEdit(), /위치/);
        assert.equal(switches, 2);
    } finally {
        globals.document = previous;
        await window.happyDOM.close();
    }
});

test("live edit resolves current widget position after preceding edits", async () => {
    const { readFile } = await import("node:fs/promises");
    const bundle = await build({
        stdin: {
            contents:
                (await readFile("src/editor.ts", "utf8")) +
                "\nexport { EmbedWidget };",
            resolveDir: `${process.cwd()}/src`,
            loader: "ts",
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        plugins: [
            {
                name: "host",
                setup(b) {
                    b.onResolve(
                        { filter: /^obsidian$|^\.\/embed$/ },
                        (args) => ({ path: args.path, namespace: "stub" }),
                    );
                    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
                        contents:
                            args.path === "obsidian"
                                ? `
                export const editorInfoField = {}; export const editorLivePreviewField = {};
                export class PluginSettingTab {} export class Setting {} export class AbstractInputSuggest {} export class TFolder {}
            `
                                : `
                export class Embed {
                    constructor(container, plugin, target, path, onEdit) { container.editEmbed = onEdit; }
                    load() {} register() {} unload() {}
                }
            `,
                    }));
                },
            },
        ],
    });
    const { EmbedWidget } = await import(
        `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    const window = new Window();
    const globals = globalThis as any;
    const previous = {
        document: globals.document,
        ResizeObserver: globals.ResizeObserver,
    };
    globals.document = window.document;
    globals.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
    try {
        let text = "![[a.ts]] and ![[a.ts]]";
        let position = text.lastIndexOf("![[");
        let selection: any;
        let focused = false;
        const view = {
            posAtDOM: () => position,
            state: { doc: { lineAt: () => ({ from: 0, text }) } },
            dispatch: (transaction: any) => {
                selection = transaction.selection;
            },
            focus: () => {
                focused = true;
            },
            requestMeasure() {},
        };
        const widget = new EmbedWidget({}, "a.ts", "note.md");
        const dom = widget.toDOM(view);
        dom.editEmbed();
        assert.equal(selection.anchor, position + 3);
        assert.equal(text.slice(selection.anchor, selection.head), "a.ts");
        text = "prefix " + text;
        position += 7;
        dom.editEmbed();
        assert.equal(selection.anchor, position + 3);
        assert.equal(focused, true);
        text = "  ![[a.ts]]  ";
        position = 0;
        dom.editEmbed();
        assert.equal(selection.anchor, 5);
        text = "![[other.ts]]";
        assert.throws(() => dom.editEmbed(), /위치/);
        widget.destroy();
    } finally {
        Object.assign(globals, previous);
        await window.happyDOM.close();
    }
});
