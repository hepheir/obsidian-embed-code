import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmbedTarget, extractLines } from "../src/core";
import { SharedRequests } from "../src/source";
test("full file, single line, inclusive range", () => {
    assert.deepEqual(parseEmbedTarget("src/a.py"), { path: "src/a.py" });
    assert.deepEqual(parseEmbedTarget("src/a.py#L10"), {
        path: "src/a.py",
        range: { start: 10, end: 10 },
    });
    assert.deepEqual(parseEmbedTarget("src/a.py#L10..30"), {
        path: "src/a.py",
        range: { start: 10, end: 30 },
    });
    assert.equal(
        extractLines("a\nb\nc\nd", { start: 2, end: 3 }).text,
        "b\nc\n",
    );
});
test("invalid and non-line selectors fail", () => {
    for (const selector of [
        "L0",
        "L-1",
        "L1..0",
        "L3..2",
        "L1..",
        "L1-3",
        "L1..L3",
        "function",
        "L1.5",
        "L9007199254740992",
        "L01",
        "",
    ]) {
        assert.throws(() => parseEmbedTarget(`a.py#${selector}`));
    }
});
test("line bounds, clamping, empty file, trailing newline", () => {
    assert.throws(() => extractLines("a\nb\n", { start: 3, end: 3 }));
    assert.deepEqual(extractLines("a\nb\n", { start: 2, end: 99 }), {
        text: "b\n",
        start: 2,
        count: 1,
    });
    assert.deepEqual(extractLines(""), { text: "", start: 1, count: 1 });
    assert.equal(extractLines("\n\n").count, 2);
    assert.throws(() => extractLines("a", { start: 0, end: 1 }));
});
test("spaces, tabs, mixed separators, Unicode preserved exactly", () => {
    const text = "  한글\r\n\tcode  \n\rfinal";
    assert.equal(extractLines(text).text, text);
    assert.equal(extractLines(text, { start: 2, end: 3 }).text, "\tcode  \n\r");
    assert.equal(extractLines("a\rb\r", { start: 2, end: 2 }).text, "b\r");
});
test("concurrent identical requests share result and settled requests retry", async () => {
    const requests = new SharedRequests<number>();
    let readCount = 0;
    const readSource = async () => ++readCount;
    const firstRequest = requests.run("file:1..3", readSource),
        secondRequest = requests.run("file:1..3", readSource);
    assert.equal(firstRequest, secondRequest);
    assert.deepEqual(await Promise.all([firstRequest, secondRequest]), [1, 1]);
    assert.equal(await requests.run("file:1..3", readSource), 2);
    await assert.rejects(
        requests.run("error", async () => {
            throw Error("fail");
        }),
    );
    assert.equal(await requests.run("error", readSource), 3);
});
