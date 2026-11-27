import {
    MarkdownRenderChild,
    MarkdownView,
    loadPrism,
    type MarkdownPostProcessorContext,
} from "obsidian";
import type CodeEmbed from "./main";
import { parseEmbedTarget, resolveVaultPath } from "./core";
import { supportsTarget } from "./settings";
import { renderCodeSnippet } from "./renderer";

export function processReadingEmbeds(
    plugin: CodeEmbed,
    container: HTMLElement,
    context: MarkdownPostProcessorContext,
): void {
    if (!plugin.settings.enabled) {
        return;
    }
    const embedElements = container.querySelectorAll<HTMLElement>(
        ".internal-embed[src]",
    );
    // DOM을 교체하기 전에 같은 섹션 내 반복 임베드의 순서를 보존합니다.
    const elements = Array.from(embedElements);
    const locations = elements.map((element) => {
        const section = context.getSectionInfo(element);
        const target = element.getAttribute("src")!;
        if (!section) return undefined;
        const peers = elements.filter((candidate) => {
            const other = context.getSectionInfo(candidate);
            return (
                candidate.getAttribute("src") === target &&
                other?.lineStart === section.lineStart &&
                other.lineEnd === section.lineEnd
            );
        });
        const matches = Array.from(
            section.text.matchAll(/!\[\[([^\]\n]+)\]\]/g),
        ).filter((match) => {
            const line =
                section.text.slice(0, match.index).split("\n").length - 1;
            return (
                line >= section.lineStart &&
                line <= section.lineEnd &&
                (match[1] === target || match[1].split("|")[0] === target)
            );
        });
        if (matches.length !== peers.length) return undefined;
        const match = matches[peers.indexOf(element)];
        return {
            text: section.text,
            from: match.index! + 3,
            length: match[1].length,
        };
    });
    for (const [index, embedElement] of elements.entries()) {
        const embedTarget = embedElement.getAttribute("src")!;
        if (!supportsTarget(embedTarget, plugin.settings)) {
            continue;
        }
        const embedContainer = document.createElement("div");
        embedElement.replaceWith(embedContainer);
        context.addChild(
            new Embed(
                embedContainer,
                plugin,
                embedTarget,
                context.sourcePath,
                async () => {
                    const location = locations[index];
                    const view = plugin.app.workspace
                        .getLeavesOfType("markdown")
                        .map((leaf) => leaf.view)
                        .find(
                            (candidate): candidate is MarkdownView =>
                                candidate instanceof MarkdownView &&
                                candidate.file?.path === context.sourcePath &&
                                candidate.containerEl.contains(embedContainer),
                        );
                    if (
                        !location ||
                        !view ||
                        view.getViewData() !== location.text
                    )
                        throw new Error(
                            "임베드 위치가 변경되었거나 확인할 수 없습니다. 노트를 새로 연 뒤 다시 시도해 주세요.",
                        );
                    await view.leaf.setViewState({
                        type: "markdown",
                        state: { ...view.getState(), mode: "source" },
                    });
                    if (
                        view.file?.path !== context.sourcePath ||
                        view.editor.getValue() !== location.text
                    )
                        throw new Error(
                            "노트 내용이 변경되어 임베드 선택을 중단했습니다.",
                        );
                    const start = view.editor.offsetToPos(location.from);
                    const end = view.editor.offsetToPos(
                        location.from + location.length,
                    );
                    view.editor.setSelection(start, end);
                    view.editor.scrollIntoView({ from: start, to: end }, true);
                    view.editor.focus();
                },
            ),
        );
    }
}

export class Embed extends MarkdownRenderChild {
    private renderVersion = 0;
    path?: string;
    private isUnloaded = false;
    constructor(
        container: HTMLElement,
        readonly plugin: CodeEmbed,
        readonly embedTarget: string,
        readonly notePath: string,
        readonly onEdit: () => void | Promise<void>,
    ) {
        super(container);
    }

    onload() {
        this.plugin.activeEmbeds.add(this);
        void this.render();
    }

    invalidate(): void {
        this.renderVersion++;
    }

    onunload() {
        this.isUnloaded = true;
        this.invalidate();
        this.plugin.activeEmbeds.delete(this);
    }

    async render(): Promise<void> {
        // 더 최신 요청이 시작되거나 화면이 해제되면 이전 결과를 폐기합니다.
        const renderVersion = ++this.renderVersion;
        const container = this.containerEl;
        const isCurrentRequest = () =>
            !this.isUnloaded && renderVersion === this.renderVersion;
        container.className = "code-embed";
        container.removeAttribute("role");
        container.removeAttribute("aria-busy");
        container.replaceChildren();
        if (!this.plugin.settings.enabled) {
            container.textContent = `![[${this.embedTarget}]]`;
            return;
        }
        container.setAttribute("aria-busy", "true");
        container.textContent = "코드 불러오는 중…";
        try {
            const target = parseEmbedTarget(this.embedTarget);
            const sourcePath = resolveVaultPath(target.path, this.notePath);
            this.path = sourcePath;
            const snippet = await this.plugin.sourceReader.read(
                sourcePath,
                target.range,
            );
            const prism = await loadPrism();
            if (!isCurrentRequest()) {
                return;
            }
            renderCodeSnippet(container, {
                app: this.plugin.app,
                onEdit: this.onEdit,
                embedTarget: this.embedTarget,
                sourcePath,
                snippet,
                settings: this.plugin.settings,
                prism,
            });
        } catch (error) {
            if (isCurrentRequest()) {
                container.replaceChildren();
                container.classList.add("code-embed-error");
                container.setAttribute("role", "alert");
                container.textContent = `Embed Code: ${error instanceof Error ? error.message : String(error)}`;
            }
        } finally {
            if (isCurrentRequest()) {
                container.removeAttribute("aria-busy");
            }
        }
    }
}
