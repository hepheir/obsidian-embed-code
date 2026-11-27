import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Window } from "happy-dom";

test("filename modifier clicks share source opening with the toolbar", async () => {
    const bundle = await build({
        entryPoints: ["src/renderer.ts"],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        plugins: [
            {
                name: "obsidian-stub",
                setup(b) {
                    b.onResolve({ filter: /^obsidian$/ }, () => ({
                        path: "obsidian",
                        namespace: "stub",
                    }));
                    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
                        contents: `
                    export class TFile {}
                    export const Platform = { isMacOS: false };
                    export class Notice { constructor(message) { notices.push(message); } }
                    export function setIcon() {}
                    export function setTooltip() {}
                `,
                    }));
                },
            },
        ],
    });
    // 같은 번들에서 호스트 객체를 내보내 플랫폼과 파일 타입을 제어합니다.
    const source = bundle.outputFiles[0].text + "\nexport { Platform, TFile };";
    const { renderCodeSnippet, Platform, TFile } = await import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    const window = new Window();
    const globals = globalThis as any;
    const previousDocument = globals.document;
    const previousNotices = globals.notices;
    globals.document = window.document;
    globals.notices = [];
    try {
        const opened: unknown[] = [];
        const file = new TFile();
        let found: unknown = file;
        let fail = false;
        const app = {
            vault: {
                getAbstractFileByPath(path: string) {
                    assert.equal(path, "folder/code.ts");
                    return found;
                },
            },
            workspace: {
                getLeaf(newLeaf: boolean) {
                    assert.equal(newLeaf, false);
                    return {
                        async openFile(value: unknown) {
                            if (fail) throw new Error("open failed");
                            opened.push(value);
                        },
                    };
                },
                async openLinkText(...args: unknown[]) {
                    opened.push(args);
                },
            },
        };
        const container = window.document.createElement("div");
        let edits = 0;
        renderCodeSnippet(container, {
            onEdit: () => {
                edits++;
            },
            app,
            embedTarget: "code.ts#L2-L3",
            sourcePath: "folder/code.ts",
            snippet: { text: "code", start: 2, count: 1 },
            settings: { collapsed: false, lineNumbers: false, wrap: false },
            prism: { languages: {} },
        });
        const filename = container.querySelector(".code-embed-filename")!;
        const details = container.querySelector("details")!;
        assert.equal(filename.textContent, "code.ts#L2-L3");
        let bubbled = 0;
        container.addEventListener("click", () => bubbled++);
        const click = (init: object) => {
            const event = new window.MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                ...init,
            });
            filename.dispatchEvent(event);
            return event;
        };
        for (const isMac of [false, true]) {
            Platform.isMacOS = isMac;
            for (const init of [
                {},
                isMac ? { ctrlKey: true } : { metaKey: true },
                { button: 2, ctrlKey: true, metaKey: true },
            ]) {
                const count = opened.length;
                assert.equal(click(init).defaultPrevented, false);
                assert.equal(opened.length, count);
            }
            const before = bubbled;
            const wasOpen = details.open;
            assert.equal(
                click(isMac ? { metaKey: true } : { ctrlKey: true })
                    .defaultPrevented,
                true,
            );
            assert.equal(bubbled, before);
            assert.equal(details.open, wasOpen);
            assert.equal(opened.at(-1), file);
        }
        found = null;
        click({ metaKey: true });
        assert.deepEqual(opened.at(-1), ["folder/code.ts", ""]);
        found = file;
        container
            .querySelector('[aria-label="원본 열기"]')!
            .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        assert.equal(opened.at(-1), file);
        const edit = container.querySelector('[aria-label="임베드 수정"]')!;
        const count = opened.length;
        const wasOpen = details.open;
        edit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        assert.equal(edits, 1);
        assert.equal(opened.length, count);
        assert.equal(details.open, wasOpen);
        fail = true;
        click({ metaKey: true });
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(globals.notices, ["Error: open failed"]);
    } finally {
        globals.document = previousDocument;
        if (previousNotices === undefined) delete globals.notices;
        else globals.notices = previousNotices;
        await window.happyDOM.close();
    }
});
