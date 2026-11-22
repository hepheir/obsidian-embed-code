import {
    MarkdownRenderChild,
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
    for (const embedElement of Array.from(embedElements)) {
        const embedTarget = embedElement.getAttribute("src")!;
        if (!supportsTarget(embedTarget, plugin.settings)) {
            continue;
        }
        const embedContainer = document.createElement("div");
        embedElement.replaceWith(embedContainer);
        context.addChild(
            new Embed(embedContainer, plugin, embedTarget, context.sourcePath),
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
