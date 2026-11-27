import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

test("folder suggestions filter partial paths, select values and close", async () => {
    const source = await readFile("src/settings.ts", "utf8");
    const bundle = await build({
        stdin: {
            loader: "ts",
            contents: source + "\nexport { FolderSuggest, TFolder };",
            resolveDir: `${process.cwd()}/src`,
        },
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
                export class PluginSettingTab {}
                export class Setting {}
                export class TFolder { constructor(path) { this.path = path; } }
                export class AbstractInputSuggest {
                    constructor(app, input) { this.input = input; }
                    onSelect(callback) { this.choose = callback; }
                    setValue(value) { this.input.value = value; }
                    close() { this.closed = true; }
                }
            `,
                    }));
                },
            },
        ],
    });
    const runtime = await import(
        `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    // 후보 선택 및 저장 연결을 검증하며 키보드 탐색은 Obsidian 기본 구현에 위임합니다.
    const folders = [
        "/",
        "code/python",
        "archive/Python",
        ".obsidian",
        "code/.hidden",
    ].map((path) => new runtime.TFolder(path));
    const app = {
        vault: { getAllLoadedFiles: () => [...folders, { path: "python.md" }] },
    };
    const input = { value: "" };
    let saved = "";
    const suggest = new runtime.FolderSuggest(app, input, (value: string) => {
        saved = value;
    });
    assert.deepEqual(suggest.getSuggestions("pYt"), [
        "archive/Python",
        "code/python",
    ]);
    assert.deepEqual(suggest.getSuggestions("new-folder"), []);
    assert.equal(suggest.getSuggestions("").length, 2);
    suggest.choose("code/python");
    assert.equal(input.value, "code/python");
    assert.equal(saved, "code/python");
    assert.equal(suggest.closed, true);
});
