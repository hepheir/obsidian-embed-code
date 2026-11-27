import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Window } from "happy-dom";

test("live preview opens extraction directly on code without editor-menu and cleans up", async () => {
    const bundle = await build({
        entryPoints: ["src/extract-ui.ts"],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        plugins: [
            {
                name: "host",
                setup(b) {
                    b.onResolve(
                        {
                            filter: /^(obsidian|@codemirror\/view)$|^\.\/extraction$/,
                        },
                        (args) => ({ path: args.path, namespace: "stub" }),
                    );
                    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
                        contents:
                            args.path === "obsidian"
                                ? `
                    export class MarkdownRenderChild {} export class TFile {} export class Notice {}
                    export const editorInfoField = 'info'; export const editorLivePreviewField = 'live';
                    export class Menu {
                        addItem(cb) { const item = { setTitle() {return item}, setIcon() {return item}, onClick(cb) { globalThis.extractClick = cb; return item} }; cb(item); }
                        showAtMouseEvent() { globalThis.menuCount++; }
                    }`
                                : args.path === "@codemirror/view"
                                  ? `
                    export const ViewPlugin = { fromClass: value => value };
                    export const EditorView = { domEventObservers: value => value };`
                                  : `
                    export class ExtractionService { async extract(input) { globalThis.extracted = input; } }`,
                    }));
                },
            },
        ],
    });
    const { registerExtraction } = await import(
        `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    const window = new Window();
    const globals = globalThis as any;
    const previous = globals.Element;
    globals.Element = window.Element;
    globals.menuCount = 0;
    try {
        const extensions: any[] = [];
        registerExtraction({
            settings: { enabled: true },
            register() {},
            registerEvent() {},
            registerEditorExtension(extension: unknown) {
                extensions.push(extension);
            },
            registerMarkdownPostProcessor() {},
            app: { workspace: { on() {} } },
        });
        const dom = window.document.createElement("div");
        dom.innerHTML = "<code><span>const x = 1;</span></code>";
        const source = "```ts\nconst x = 1;\n```";
        let live = true;
        let position = 9;
        const view = {
            dom,
            state: {
                field(key: string) {
                    return key === "live"
                        ? live
                        : { file: { path: "note.md" } };
                },
                doc: { toString: () => source },
            },
            posAtCoords: () => position,
        };
        const observer = new extensions[0](view);
        let bubbled = 0;
        dom.querySelector("code")!.addEventListener(
            "contextmenu",
            () => bubbled++,
        );
        const click = () =>
            dom.querySelector("span")!.dispatchEvent(
                new window.MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                }),
            );
        assert.equal(click(), false);
        assert.equal(globals.menuCount, 1);
        assert.equal(bubbled, 0);
        await globals.extractClick();
        await Promise.resolve();
        assert.equal(globals.extracted.fence.code, "const x = 1;\n");
        live = false;
        click();
        assert.equal(globals.menuCount, 1);
        live = true;
        position = source.length;
        click();
        assert.equal(globals.menuCount, 1);
        position = 9;
        observer.destroy();
        click();
        assert.equal(globals.menuCount, 1);
    } finally {
        globals.Element = previous;
        delete globals.menuCount;
        delete globals.extractClick;
        delete globals.extracted;
        await window.happyDOM.close();
    }
});
