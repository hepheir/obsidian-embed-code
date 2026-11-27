import { test } from "node:test";
import assert from "node:assert/strict";
import {
    extractionPath,
    automaticExtractionPath,
    normalizeExtractionDirectory,
    normalizeExtractionExtension,
    findFences,
    suggestedName,
    trackFence,
} from "../src/extraction-core";

test("fence extraction preserves code and separators, supports long and tilde fences", () => {
    const text = "intro\r\n````python\r\n  a\r\n```\r\n\tb\r\n````\r\n~~~\n~~~";
    const blocks = findFences(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].code, "  a\r\n```\r\n\tb\r\n");
    assert.equal(blocks[0].language, "python");
    assert.equal(blocks[1].code, "");
    assert.equal(text.slice(blocks[0].from, blocks[0].to), blocks[0].raw);
});

test("quote and list containers are stripped from code but retained for replacement", () => {
    const [quote] = findFences("> ```mermaid\n> graph LR\n>   A-->B\n> ```\n");
    assert.equal(quote.code, "graph LR\n  A-->B\n");
    assert.equal(quote.prefix, "> ");
    const [list] = findFences("- ```js\n  const a = 1;\n  ```\n");
    assert.equal(list.code, "const a = 1;\n");
    assert.equal(list.prefix, "- ");
    const [nested] = findFences("> - ```py\n>   x\n>   ```");
    assert.equal(nested.code, "x\n");
});

test("identical blocks stay distinct and edits inside the target invalidate it", () => {
    const text = "```py\nx\n```\n\n```py\nx\n```\n";
    const [first, second] = findFences(text);
    assert.notEqual(first.from, second.from);
    const shifted = trackFence(text, "intro\n" + text, second)!;
    assert.equal(shifted.from, second.from + 6);
    assert.equal(
        trackFence(
            text,
            text.slice(0, second.from) + "```py\ny\n```\n",
            second,
        ),
        null,
    );
    assert.equal(trackFence(text, text + "after", first)?.from, first.from);
    assert.equal(trackFence(text, "", second), null);
});

test("only closed fenced blocks are extracted", () => {
    assert.equal(findFences("    ```js\n    x\n    ```").length, 0);
    assert.equal(findFences("```js\nx\n").length, 0);
    assert.equal(findFences("`inline`").length, 0);
});

test("paths follow note-relative and root rules and reject unsafe embed paths", () => {
    assert.equal(
        extractionPath("scripts/a.py", "notes/a.md"),
        "notes/scripts/a.py",
    );
    assert.equal(extractionPath("/scripts/a.py", "notes/a.md"), "scripts/a.py");
    assert.equal(extractionPath("../a.py", "notes/a.md"), "a.py");
    for (const path of [
        "../../a.py",
        "https://x/a.py",
        "a#L1.py",
        "a|b.py",
        "a].py",
        "",
        "folder/",
        "/notes/a.md",
        ".obsidian/a.py",
    ]) {
        assert.throws(() => extractionPath(path, "notes/a.md"));
    }
    assert.equal(suggestedName("mermaid"), "code.mmd");
    assert.equal(suggestedName("python"), "code.py");
    assert.equal(suggestedName("unknown"), "code.txt");
});

test("automatic names use local YYMMDDHHmmss, mapped and fallback extensions", () => {
    const now = new Date(2026, 10, 28, 15, 30, 12);
    assert.equal(
        automaticExtractionPath("notes/회의록.md", "python", "", "txt", now),
        "회의록_261128153012.py",
    );
    assert.equal(
        automaticExtractionPath(
            "notes/a.md",
            "unknown",
            "/code/nested/",
            ".LOG",
            now,
        ),
        "code/nested/a_261128153012.log",
    );
    assert.equal(
        automaticExtractionPath(
            "a.md",
            "",
            "",
            "txt",
            new Date(2026, 0, 2, 3, 4, 5),
        ),
        "a_260102030405.txt",
    );
    for (const path of [
        "../x",
        ".obsidian",
        "a//b",
        "a#b",
        "https://x",
        "a\\b",
    ])
        assert.throws(() => normalizeExtractionDirectory(path));
    for (const ext of ["", "../py", "a/b", "a.b"])
        assert.throws(() => normalizeExtractionExtension(ext));
});
