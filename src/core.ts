export interface LineRange {
    start: number;
    end?: number;
}

export interface EmbedTarget {
    path: string;
    range?: LineRange;
}

export interface CodeSnippet {
    text: string;
    start: number;
    count: number;
}

// 파일을 읽기 전에 행 범위를 검사합니다. 함수명 등으로 구간을 지정할 수는 없습니다.
export function parseEmbedTarget(embedTarget: string): EmbedTarget {
    const targetText = embedTarget.split("|")[0].trim();
    const fragmentIndex = targetText.indexOf("#");
    const path =
        fragmentIndex < 0 ? targetText : targetText.slice(0, fragmentIndex);
    if (!path) {
        throw new Error("파일 경로가 없습니다.");
    }
    if (fragmentIndex < 0) {
        return { path };
    }
    const rangeMatch = /^L([1-9]\d*)(?:\.\.([1-9]\d*))?$/.exec(
        targetText.slice(fragmentIndex + 1),
    );
    if (!rangeMatch) {
        throw new Error("행 범위는 #L10 또는 #L10..30 형식이어야 합니다.");
    }
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2] ?? rangeMatch[1]);
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        end < start
    ) {
        throw new Error("유효하지 않은 행 범위입니다.");
    }
    return { path, range: { start, end } };
}

// CRLF 등 원본 구분자를 보존하며 마지막 줄바꿈은 가상 행으로 세지 않습니다.
export function splitLines(text: string): string[] {
    const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [""];
    if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

export function extractLines(text: string, range?: LineRange): CodeSnippet {
    const lines = splitLines(text);
    const start = range?.start ?? 1;
    const end = Math.min(range?.end ?? lines.length, lines.length);
    if (
        !Number.isSafeInteger(start) ||
        start < 1 ||
        (range?.end !== undefined &&
            (!Number.isSafeInteger(range.end) || range.end < start))
    ) {
        throw new Error("유효하지 않은 행 범위입니다.");
    }
    if (start > lines.length) {
        throw new Error(
            `시작 행 ${start}이 마지막 행 ${lines.length}을 초과합니다.`,
        );
    }
    // 원본 행 번호는 1부터 시작하고, 배열의 끝 인덱스는 구간에 포함되지 않습니다.
    return {
        text: lines.slice(start - 1, end).join(""),
        start,
        count: end - start + 1,
    };
}

export function getFileExtension(path: string): string {
    return (path.split("/").pop()?.split(".").pop() ?? "").toLowerCase();
}

// 현재 열린 노트가 아니라 임베드가 있는 노트의 폴더를 기준으로 경로를 찾습니다.
export function resolveVaultPath(path: string, notePath: string): string {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
        throw new Error("Vault 내부 파일 경로만 지원합니다.");
    }
    const pathSegments = path.startsWith("/")
        ? []
        : notePath.split("/").slice(0, -1);
    for (const segment of path.split("/")) {
        if (!segment || segment === ".") {
            continue;
        }
        if (segment === "..") {
            if (!pathSegments.length) {
                throw new Error("Vault 밖의 경로는 사용할 수 없습니다.");
            }
            pathSegments.pop();
        } else {
            pathSegments.push(segment);
        }
    }
    return pathSegments.join("/");
}
