import {
    MarkdownRenderChild,
    Menu,
    Modal,
    Notice,
    Setting,
    TFile,
    editorInfoField,
    editorLivePreviewField,
    type App,
    type MarkdownPostProcessorContext,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import type CodeEmbed from "./main";
import { findFences } from "./extraction-core";
import {
    ExtractionService,
    type ExtractionInput,
    type ExtractionPrompts,
} from "./extraction";

class PathModal extends Modal {
    private settled = false;
    constructor(
        app: App,
        private initial: string,
        private validate: (value: string) => string | null,
        private finish: (value: string | null) => void,
    ) {
        super(app);
    }
    onOpen() {
        this.titleEl.setText("파일로 추출");
        let value = this.initial;
        let submit = () => {};
        new Setting(this.contentEl)
            .setName("저장 경로")
            .setDesc("노트 폴더 기준 상대 경로 또는 /로 시작하는 Vault 경로")
            .addText((control) => {
                control.setValue(value).onChange((next) => {
                    value = next;
                });
                control.inputEl.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") submit();
                });
            });
        const error = this.contentEl.createDiv({ attr: { role: "alert" } });
        submit = () => {
            const message = this.validate(value);
            if (message) {
                error.setText(message);
                return;
            }
            this.settled = true;
            this.finish(value);
            this.close();
        };
        new Setting(this.contentEl).addButton((b) =>
            b.setButtonText("추출").setCta().onClick(submit),
        );
    }
    onClose() {
        if (!this.settled) this.finish(null);
        this.contentEl.empty();
    }
}

class OverwriteModal extends Modal {
    private accepted = false;
    constructor(
        app: App,
        private path: string,
        private finish: (value: boolean) => void,
    ) {
        super(app);
    }
    onOpen() {
        this.titleEl.setText("파일을 덮어쓰시겠습니까?");
        this.contentEl.createEl("p", { text: this.path });
        new Setting(this.contentEl)
            .addButton((b) =>
                b.setButtonText("취소").onClick(() => this.close()),
            )
            .addButton((b) =>
                b
                    .setButtonText("덮어쓰기")
                    .setWarning()
                    .onClick(() => {
                        this.accepted = true;
                        this.close();
                    }),
            );
    }
    onClose() {
        this.finish(this.accepted);
        this.contentEl.empty();
    }
}

export function registerExtraction(plugin: CodeEmbed): void {
    const service = new ExtractionService(plugin);
    const sections = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
    const modals = new Set<Modal>();
    const children = new Set<MarkdownRenderChild>();
    plugin.register(() => {
        for (const child of children) child.unload();
    });
    const openModal = (modal: Modal) => {
        modals.add(modal);
        const close = modal.onClose.bind(modal);
        modal.onClose = () => {
            modals.delete(modal);
            close();
        };
        modal.open();
    };
    plugin.register(() => {
        for (const modal of modals) modal.close();
    });
    const prompts: ExtractionPrompts = {
        path: (initial, validate) =>
            new Promise((resolve) =>
                openModal(
                    new PathModal(plugin.app, initial, validate, resolve),
                ),
            ),
        overwrite: (path) =>
            new Promise((resolve) =>
                openModal(new OverwriteModal(plugin.app, path, resolve)),
            ),
    };
    const addItem = (menu: Menu, input: ExtractionInput) => {
        menu.addItem((item) =>
            item
                .setTitle("파일로 추출…")
                .setIcon("file-output")
                .onClick(() => {
                    void service
                        .extract(input, prompts)
                        .catch((error: unknown) => new Notice(String(error)));
                }),
        );
    };
    // 기본 에디터 메뉴가 생성되기 전에 우클릭 위치만 기록합니다.
    let clicked: { editor: unknown; offset: number; time: number } | undefined;
    plugin.registerEditorExtension(
        EditorView.domEventObservers({
            contextmenu(event, view) {
                clicked = undefined;
                if (!view.state.field(editorLivePreviewField, false))
                    return false;
                const info = view.state.field(editorInfoField, false);
                // 렌더링 위젯은 화면 좌표가 fence 끝에 매핑될 수 있어 원본 섹션을 우선합니다.
                const target =
                    event.target instanceof Element ? event.target : null;
                const rendered = target?.closest(
                    "pre, .mermaid, [class*='block-language-']",
                );
                let mapped: MarkdownPostProcessorContext | undefined;
                for (
                    let node = rendered;
                    node instanceof HTMLElement && !mapped;
                    node = node.parentElement
                ) {
                    mapped = sections.get(node);
                }
                let offset = view.posAtCoords({
                    x: event.clientX,
                    y: event.clientY,
                });
                if (offset === null && event.target instanceof Node) {
                    try {
                        offset = view.posAtDOM(event.target);
                    } catch {
                        /* 대상을 특정할 수 없으면 메뉴를 추가하지 않습니다. */
                    }
                }
                if (mapped) {
                    const section = mapped.getSectionInfo(
                        rendered as HTMLElement,
                    );
                    if (!section || section.text !== view.state.doc.toString())
                        return false;
                    const blocks = findFences(section.text).filter(
                        (block) =>
                            block.lineStart >= section.lineStart &&
                            block.lineEnd <= section.lineEnd,
                    );
                    if (blocks.length !== 1) return false;
                    offset = blocks[0].from;
                }
                if (offset !== null && info?.editor)
                    clicked = { editor: info.editor, offset, time: Date.now() };
                return false;
            },
        }),
    );
    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
            const click = clicked;
            clicked = undefined;
            if (
                !plugin.settings.enabled ||
                !click ||
                click.editor !== editor ||
                Date.now() - click.time > 1000 ||
                !info.file
            )
                return;
            const text = editor.getValue();
            const fence = findFences(text).find(
                (block) =>
                    block.from <= click.offset && click.offset <= block.to,
            );
            if (fence) addItem(menu, { file: info.file, text, fence });
        }),
    );
    plugin.registerMarkdownPostProcessor((container, context) => {
        const selector = "pre, .mermaid, [class*='block-language-']";
        sections.set(container, context);
        for (const rendered of Array.from(
            container.querySelectorAll<HTMLElement>(selector),
        ))
            sections.set(rendered, context);
        const child = new MarkdownRenderChild(container);
        context.addChild(child);
        children.add(child);
        child.register(() => children.delete(child));
        child.registerDomEvent(
            container,
            "contextmenu",
            (event: MouseEvent) => {
                if (
                    !plugin.settings.enabled ||
                    event.defaultPrevented ||
                    container.closest(".markdown-source-view") ||
                    !(event.target instanceof Element)
                )
                    return;
                // 렌더러 경계를 사용하여 인접한 블록과 혼동하지 않습니다.
                const rendered = event.target.closest(
                    "pre, .mermaid, .block-language-mermaid, [class*='block-language-']",
                );
                if (
                    !(rendered instanceof HTMLElement) ||
                    !container.contains(rendered) ||
                    rendered.closest(".code-embed")
                )
                    return;
                const section = context.getSectionInfo(rendered);
                if (!section) return;
                const blocks = findFences(section.text).filter(
                    (block) =>
                        block.lineStart >= section.lineStart &&
                        block.lineEnd <= section.lineEnd,
                );
                if (blocks.length !== 1) return;
                const file = plugin.app.vault.getAbstractFileByPath(
                    context.sourcePath,
                );
                if (!(file instanceof TFile)) return;
                event.preventDefault();
                event.stopPropagation();
                const menu = new Menu();
                addItem(menu, { file, text: section.text, fence: blocks[0] });
                menu.showAtMouseEvent(event);
            },
        );
    }, 1000);
}
