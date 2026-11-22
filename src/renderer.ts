import { TFile, Notice, setIcon, setTooltip, type App } from "obsidian";
import { getFileExtension, splitLines, type CodeSnippet } from "./core";
import type { CodeEmbedSettings } from "./settings";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
    py: "python",
    js: "javascript",
    ts: "typescript",
    sh: "bash",
    yml: "yaml",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    rs: "rust",
    rb: "ruby",
    kt: "kotlin",
    md: "markdown",
    txt: "plain",
};

interface RenderOptions {
    app: App;
    embedTarget: string;
    sourcePath: string;
    snippet: CodeSnippet;
    settings: CodeEmbedSettings;
    prism: Awaited<ReturnType<typeof import("obsidian").loadPrism>>;
}

export function renderCodeSnippet(
    container: HTMLElement,
    options: RenderOptions,
): void {
    const { app, embedTarget, sourcePath, snippet, settings, prism } = options;
    container.replaceChildren();
    const details = document.createElement("details");
    details.open = !settings.collapsed;
    const summary = document.createElement("summary");
    summary.textContent = embedTarget;
    details.append(summary);
    details.append(createToolbar(app, snippet.text, sourcePath));
    const body = document.createElement("div");
    body.className = "code-embed-body";
    if (settings.lineNumbers) {
        const gutter = document.createElement("pre");
        gutter.className = "code-embed-lines";
        gutter.setAttribute("aria-hidden", "true");
        gutter.textContent = Array.from(
            { length: snippet.count },
            (_, lineIndex) => String(snippet.start + lineIndex),
        ).join("\n");
        body.append(gutter);
    }
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    const fileExtension = getFileExtension(sourcePath);
    const language = LANGUAGE_BY_EXTENSION[fileExtension] ?? fileExtension;
    code.className = `language-${language}`;
    const grammar = prism.languages[language];
    if (grammar) {
        code.innerHTML = prism.highlight(snippet.text, grammar, language);
    } else {
        code.textContent = snippet.text;
    }
    pre.append(code);
    body.append(pre);
    details.append(body);
    container.append(details);
    container.classList.toggle("code-embed-wrap", settings.wrap);
    // 줄바꿈된 코드 옆에도 원본 행 번호가 맞춰지도록 행별로 배치합니다.
    if (settings.wrap && settings.lineNumbers) {
        renderWrappedLines(body, code, snippet.text, snippet.start, language);
    }
}

function createToolbar(
    app: App,
    sourceText: string,
    path: string,
): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "code-embed-tools";
    // 아이콘만 보여도 스크린리더가 기능을 읽을 수 있도록 이름을 붙입니다.
    const addIconButton = (
        label: string,
        icon: string,
        action: () => Promise<unknown>,
    ) => {
        const iconButton = document.createElement("button");
        iconButton.type = "button";
        iconButton.className = "clickable-icon code-embed-action";
        iconButton.setAttribute("aria-label", label);
        setIcon(iconButton, icon);
        setTooltip(iconButton, label);
        iconButton.onclick = () => {
            void action().catch((error: unknown) => new Notice(String(error)));
        };
        toolbar.append(iconButton);
    };
    addIconButton("코드 복사", "copy", async () => {
        await navigator.clipboard.writeText(sourceText);
        new Notice("코드를 복사했습니다.");
    });
    addIconButton("원본 열기", "external-link", async () => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            await app.workspace.getLeaf(false).openFile(file);
        } else {
            await app.workspace.openLinkText(path, "");
        }
    });
    return toolbar;
}

// 강조한 코드를 행별로 복제해 여러 줄 주석과 문자열의 색상을 유지합니다.
function renderWrappedLines(
    body: HTMLElement,
    code: HTMLElement,
    sourceText: string,
    startLine: number,
    language: string,
): void {
    const lines = splitLines(sourceText);
    body.classList.add("code-embed-grid");
    body.replaceChildren();
    const textWalker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (textWalker.nextNode()) {
        textNodes.push(textWalker.currentNode as Text);
    }
    // 문자열의 절대 위치를 강조 태그 안의 텍스트 노드 위치로 변환합니다.
    const findTextPosition = (textOffset: number): [Node, number] => {
        for (const node of textNodes) {
            if (textOffset <= node.length) {
                return [node, textOffset];
            }
            textOffset -= node.length;
        }
        return [code, code.childNodes.length];
    };
    let textOffset = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineNumber = document.createElement("span");
        lineNumber.className = "code-embed-number";
        lineNumber.textContent = String(startLine + lineIndex);
        lineNumber.setAttribute("aria-hidden", "true");
        const row = document.createElement("pre");
        const lineCode = document.createElement("code");
        lineCode.className = `language-${language}`;
        const lineRange = document.createRange();
        lineRange.setStart(...findTextPosition(textOffset));
        textOffset += lines[lineIndex].length;
        lineRange.setEnd(...findTextPosition(textOffset));
        lineCode.append(lineRange.cloneContents());
        row.append(lineCode);
        body.append(lineNumber, row);
    }
}
