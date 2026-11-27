import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { findFences } from "../src/extraction-core";
import type { ExtractionService, ExtractionPrompts } from "../src/extraction";

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
                            "export class TFile { constructor(path) { this.path = path; } } export class TFolder {} export class MarkdownView {} export class PluginSettingTab {} export class Setting {}",
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
        settings: { extensions: "mmd,py,txt" },
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
    const prompts: ExtractionPrompts = {
        path: async () => "scripts/code.mmd",
        overwrite: async () => true,
    };
    return {
        runtime,
        service,
        input,
        prompts,
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

test("service creates folders, saves Mermaid source, then replaces only the fence", async () => {
    const h = await harness();
    await h.service.extract(h.input, h.prompts);
    assert.equal(
        h.contents.get("notes/scripts/code.mmd"),
        "graph LR\n  A-->B\n",
    );
    assert.equal(
        h.contents.get(h.input.file.path),
        "intro\n![[/notes/scripts/code.mmd]]\n",
    );
    assert.ok(h.files.has("notes/scripts"));
});

test("save failure and changed source leave the original note untouched", async () => {
    const h = await harness();
    h.setFailWrite();
    await assert.rejects(h.service.extract(h.input, h.prompts), /write failed/);
    assert.equal(h.contents.get(h.input.file.path), h.original);
    const other = await harness();
    other.prompts.path = async () => {
        other.contents.set(other.input.file.path, "changed");
        return "code.mmd";
    };
    await assert.rejects(
        other.service.extract(other.input, other.prompts),
        /대상 코드/,
    );
    assert.equal(other.contents.has("notes/code.mmd"), false);
});

test("cancelled overwrite returns to path input and destination changes abort overwrite", async () => {
    const h = await harness();
    const destination = new h.runtime.TFile("notes/code.mmd");
    h.files.set(destination.path, destination);
    h.contents.set(destination.path, "old");
    let count = 0;
    h.prompts.path = async () => (++count === 1 ? "code.mmd" : null);
    h.prompts.overwrite = async () => false;
    await h.service.extract(h.input, h.prompts);
    assert.equal(count, 2);
    assert.equal(h.contents.get(destination.path), "old");
    h.prompts.path = async () => "code.mmd";
    h.prompts.overwrite = async () => {
        h.contents.set(destination.path, "external change");
        return true;
    };
    await assert.rejects(
        h.service.extract(h.input, h.prompts),
        /덮어쓰기 대상이 변경/,
    );
    assert.equal(h.contents.get(destination.path), "external change");
    assert.equal(h.contents.get(h.input.file.path), h.original);
});

test("note replacement failure reports saved path and retains source", async () => {
    const h = await harness();
    h.setFailNote();
    await assert.rejects(
        h.service.extract(h.input, h.prompts),
        /notes\/scripts\/code.mmd에 저장했지만/,
    );
    assert.equal(h.contents.get(h.input.file.path), h.original);
    assert.ok(h.contents.has("notes/scripts/code.mmd"));
});

test("settings migration adds mmd once and respects subsequent removal", async () => {
    const { runtime } = await harness();
    assert.equal(
        runtime.loadSettings({ extensions: "py,js" }).extensions,
        "py,js,mmd",
    );
    assert.equal(
        runtime.loadSettings({ extensions: "py,mmd" }).extensions,
        "py,mmd",
    );
    assert.equal(
        runtime.loadSettings({ extensions: "py", extractionVersion: 1 })
            .extensions,
        "py",
    );
});

test("confirmed overwrite saves exact source and concurrent extraction is rejected", async () => {
    const h = await harness();
    const destination = new h.runtime.TFile("notes/code.mmd");
    h.files.set(destination.path, destination);
    h.contents.set(destination.path, "old");
    let release!: (path: string | null) => void;
    h.prompts.path = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const pending = h.service.extract(h.input, h.prompts);
    await assert.rejects(h.service.extract(h.input, h.prompts), /진행중/);
    release("code.mmd");
    await pending;
    assert.equal(h.contents.get(destination.path), "graph LR\n  A-->B\n");
    assert.equal(
        h.contents.get(h.input.file.path),
        "intro\n![[/notes/code.mmd]]\n",
    );
});
