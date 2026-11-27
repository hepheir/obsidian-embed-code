import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { findFences } from "../src/extraction-core";
import type { ExtractionService } from "../src/extraction";

// Obsidian 런타임 대신 최소 Vault를 사용하여 저장 순서와 실패 시 동작을 검증합니다.
async function harness() {
    const bundle = await build({
        stdin: {
            contents:
                'export { ExtractionService } from "./src/extraction"; export { loadSettings } from "./src/settings"; export { TFile, TFolder } from "obsidian";',
            resolveDir: process.cwd(),
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        plugins: [
            {
                name: "obsidian-test",
                setup(b) {
                    b.onResolve({ filter: /^obsidian$/ }, () => ({
                        path: "obsidian",
                        namespace: "stub",
                    }));
                    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
                        contents:
                            "export class TFile { constructor(path) { this.path = path; } } export class TFolder {} export class MarkdownView {} export class PluginSettingTab {} export class Setting {} export class AbstractInputSuggest {}",
                    }));
                },
            },
        ],
    });
    const runtime = await import(
        `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    const file = new runtime.TFile("notes/note.md");
    const original = "intro\n```mermaid\ngraph LR\n  A-->B\n```\n";
    const contents = new Map<string, string>([[file.path, original]]);
    const files = new Map<string, any>([[file.path, file]]);
    let failWrite = false;
    let failNote = false;
    const plugin = {
        register() {},
        settings: {
            extensions: "mmd,py,txt",
            extractionDirectory: "scripts/nested",
            extractionDefaultExtension: "txt",
        },
        app: {
            workspace: {
                on() {
                    return {};
                },
                offref() {},
                iterateAllLeaves() {},
            },
            vault: {
                getAbstractFileByPath(path: string) {
                    return files.get(path) ?? null;
                },
                async read(target: { path: string }) {
                    return contents.get(target.path)!;
                },
                async createFolder(path: string) {
                    files.set(path, new runtime.TFolder());
                },
                async create(path: string, text: string) {
                    if (failWrite || files.has(path))
                        throw Error("write failed");
                    files.set(path, new runtime.TFile(path));
                    contents.set(path, text);
                },
                async process(
                    target: { path: string },
                    transform: (text: string) => string,
                ) {
                    if (failNote && target === file)
                        throw Error("note write failed");
                    const next = transform(contents.get(target.path)!);
                    contents.set(target.path, next);
                    return next;
                },
            },
        },
    };
    const service: ExtractionService = new runtime.ExtractionService(plugin);
    const input = { file, text: original, fence: findFences(original)[0] };
    return {
        runtime,
        service,
        input,
        plugin,
        original,
        contents,
        files,
        setFailWrite() {
            failWrite = true;
        },
        setFailNote() {
            failNote = true;
        },
    };
}

test("creates configured folders and replaces only the fence", async () => {
    const h = await harness();
    await h.service.extract(h.input);
    const path = [...h.contents.keys()].find(
        (path) => path !== h.input.file.path,
    )!;
    assert.match(path, /^scripts\/nested\/note_\d{12}\.mmd$/);
    assert.equal(h.contents.get(path), "graph LR\n  A-->B\n");
    assert.equal(h.contents.get(h.input.file.path), `intro\n![[/${path}]]\n`);
    assert.ok(h.files.has("scripts/nested"));
});

test("save failure and changed source leave the note untouched", async () => {
    const h = await harness();
    h.setFailWrite();
    await assert.rejects(h.service.extract(h.input), /write failed/);
    assert.equal(h.contents.get(h.input.file.path), h.original);
    const other = await harness();
    other.contents.set(other.input.file.path, "changed");
    await assert.rejects(other.service.extract(other.input), /대상 코드/);
    assert.equal(other.contents.size, 1);
});

test("replacement failure reports saved path and retains saved source", async () => {
    const h = await harness();
    h.setFailNote();
    await assert.rejects(h.service.extract(h.input), /에 저장했지만/);
    assert.equal(h.contents.get(h.input.file.path), h.original);
    assert.equal(h.contents.size, 2);
});

test("collisions with files and folders get suffixes without overwriting", async () => {
    const h = await harness();
    const lookup = h.plugin.app.vault.getAbstractFileByPath;
    h.plugin.app.vault.getAbstractFileByPath = (path) => {
        if (/note_\d{12}\.mmd$/.test(path)) return new h.runtime.TFile(path);
        if (/note_\d{12}_2\.mmd$/.test(path)) return new h.runtime.TFolder();
        return lookup(path);
    };
    await h.service.extract(h.input);
    assert.ok([...h.contents.keys()].some((path) => /_3\.mmd$/.test(path)));
});

test("defaults, root destination, fallback and unsupported extensions", async () => {
    const h = await harness();
    const defaults = h.runtime.loadSettings(null);
    assert.equal(defaults.extractionDirectory, "");
    assert.equal(defaults.extractionDefaultExtension, "txt");
    h.plugin.settings.extractionDirectory = "";
    h.input.fence.language = "unknown";
    await h.service.extract(h.input);
    assert.ok(
        [...h.contents.keys()].some((path) => /^note_\d{12}\.txt$/.test(path)),
    );
    const other = await harness();
    other.plugin.settings.extensions = "txt";
    await assert.rejects(
        other.service.extract(other.input),
        /지원하지 않는 확장자/,
    );
    assert.equal(other.contents.size, 1);
});

test("invalid directory and a file blocking a folder abort before saving", async () => {
    const h = await harness();
    h.plugin.settings.extractionDirectory = "../outside";
    await assert.rejects(h.service.extract(h.input), /저장 폴더/);
    h.plugin.settings.extractionDirectory = "blocked/nested";
    h.files.set("blocked", new h.runtime.TFile("blocked"));
    await assert.rejects(h.service.extract(h.input), /폴더 경로에 파일/);
    assert.equal(h.contents.size, 1);
});

test("concurrent extraction is rejected", async () => {
    const h = await harness();
    const pending = h.service.extract(h.input);
    await assert.rejects(h.service.extract(h.input), /진행중/);
    await pending;
});

test("settings migration adds mmd once and respects removal", async () => {
    const { runtime } = await harness();
    assert.equal(
        runtime.loadSettings({ extensions: "py,js" }).extensions,
        "py,js,mmd",
    );
    assert.equal(
        runtime.loadSettings({ extensions: "py", extractionVersion: 1 })
            .extensions,
        "py",
    );
});
