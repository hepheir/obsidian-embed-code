import { resolveVaultPath, splitLines } from "./core";

export interface Fence {
    from: number;
    to: number;
    lineStart: number;
    lineEnd: number;
    raw: string;
    code: string;
    language: string;
    prefix: string;
}

// 목록·인용문 접두사는 파일 내용에서 제외하고 임베드 위치에는 유지합니다.
export function findFences(text: string): Fence[] {
    const lines = splitLines(text);
    const result: Fence[] = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const opening =
            /^( {0,3}(?:> ? {0,3})*(?:(?:[-+*]|\d+[.)]) +)?)(`{3,}|~{3,})([^\r\n]*)/.exec(
                lines[i],
            );
        if (!opening || (opening[2][0] === "`" && opening[3].includes("`"))) {
            offset += lines[i].length;
            continue;
        }
        const prefix = opening[1];
        const continuation = prefix.replace(/[-+*]|\d+[.)]/g, (s) =>
            " ".repeat(s.length),
        );
        let code = "";
        let end = offset + lines[i].length;
        let found = false;
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const content = line.startsWith(continuation)
                ? line.slice(continuation.length)
                : line;
            const close = /^( {0,3})(`{3,}|~{3,})[ \t]*(?:\r\n|\r|\n)?$/.exec(
                content,
            );
            if (
                close &&
                close[2][0] === opening[2][0] &&
                close[2].length >= opening[2].length
            ) {
                const closing = line.replace(/[\r\n]+$/, "");
                const to = end + closing.length;
                result.push({
                    from: offset,
                    to,
                    lineStart: i,
                    lineEnd: j,
                    raw: text.slice(offset, to),
                    code,
                    language: opening[3].trim().split(/\s/)[0].toLowerCase(),
                    prefix,
                });
                offset = end + line.length;
                i = j;
                found = true;
                break;
            }
            code += content;
            end += line.length;
        }
        if (!found) break;
    }
    return result;
}

export function trackFence(
    before: string,
    after: string,
    fence: Fence,
): Fence | null {
    if (before === after) return fence;
    let start = 0;
    while (
        start < before.length &&
        start < after.length &&
        before[start] === after[start]
    )
        start++;
    let oldEnd = before.length,
        newEnd = after.length;
    while (
        oldEnd > start &&
        newEnd > start &&
        before[oldEnd - 1] === after[newEnd - 1]
    ) {
        oldEnd--;
        newEnd--;
    }
    if (oldEnd <= fence.from && start < fence.from) {
        const delta = newEnd - oldEnd;
        return { ...fence, from: fence.from + delta, to: fence.to + delta };
    }
    if (start >= fence.to) return fence;
    return null;
}

export function extractionPath(input: string, notePath: string): string {
    if (
        !input.trim() ||
        /[\\\[\]#|\r\n\x00-\x1f:]/.test(input) ||
        input.endsWith("/")
    )
        throw Error("파일명과 확장자를 포함한 Vault 내부 경로를 입력하세요.");
    const path = resolveVaultPath(input.trim(), notePath);
    if (
        !path ||
        path === notePath ||
        path.split("/").some((part) => part.startsWith("."))
    )
        throw Error("노트 자신이나 숨김 경로에는 저장할 수 없습니다.");
    return path;
}

export function suggestedName(language: string, fallback = "txt"): string {
    const extensions: Record<string, string> = {
        python: "py",
        javascript: "js",
        typescript: "ts",
        mermaid: "mmd",
        bash: "sh",
        shell: "sh",
        rust: "rs",
        ruby: "rb",
        csharp: "cs",
        kotlin: "kt",
        markdown: "md",
        yaml: "yml",
        "c++": "cpp",
    };
    const extension =
        extensions[language] ??
        (/^(py|js|ts|tsx|jsx|json|html|css|scss|java|c|cpp|h|hpp|cs|go|rs|rb|php|sh|sql|yaml|yml|toml|xml|txt|md|swift|kt|mmd)$/.test(
            language,
        )
            ? language
            : normalizeExtractionExtension(fallback));
    return `code.${extension}`;
}

// 설정 경로는 항상 Vault 루트 기준이며 숨김·상위 경로를 허용하지 않습니다.
export function normalizeExtractionDirectory(value: string): string {
    const path = value.trim().replace(/^\/+|\/+$/g, "");
    if (
        /[\\\[\]#|\x00-\x1f:*?"<>]/.test(path) ||
        path
            .split("/")
            .some(
                (part) => part.startsWith(".") || (part === "" && path !== ""),
            )
    )
        throw Error("Vault 내부의 유효한 저장 폴더를 입력하세요.");
    return path;
}

export function normalizeExtractionExtension(value: string): string {
    const extension = value.trim().replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]+$/.test(extension))
        throw Error("기본 확장자는 영문 또는 숫자로 입력하세요.");
    return extension;
}

export function automaticExtractionPath(
    notePath: string,
    language: string,
    directory: string,
    fallback: string,
    now: Date,
): string {
    const folder = normalizeExtractionDirectory(directory);
    normalizeExtractionExtension(fallback);
    const basename = notePath
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, "");
    const pad = (value: number) => String(value).padStart(2, "0");
    const time = [
        now.getFullYear() % 100,
        now.getMonth() + 1,
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
    ]
        .map(pad)
        .join("");
    const extension = suggestedName(language, fallback).slice(5);
    const name = `${basename}_${time}.${extension}`;
    return extractionPath(`/${folder ? folder + "/" : ""}${name}`, notePath);
}
