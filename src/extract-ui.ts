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
import { resolveExtractionTarget } from "./extraction-target";
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
                let mapped: MarkdownPostProcessorContext | undefined;
                let mappedContainer: HTMLElement | undefined;
                for (let node = target; node; node = node.parentElement) {
                    if (node instanceof HTMLElement && sections.has(node)) {
                        mapped = sections.get(node);
                        mappedContainer = node;
                        break;
                    }
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
                if (mapped && mappedContainer && target) {
                    const resolved = resolveExtractionTarget(
                        target,
                        mappedContainer,
                        mapped,
                    );
                    if (
                        !resolved ||
                        resolved.text !== view.state.doc.toString()
                    )
                        return false;
                    offset = resolved.fence.from;
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
        sections.set(container, context);
        const child = new MarkdownRenderChild(container);
        context.addChild(child);
        children.add(child);
        child.register(() => {
            children.delete(child);
            sections.delete(container);
        });
        const onContextMenu = (event: MouseEvent) => {
            if (
                !plugin.settings.enabled ||
                container.closest(".markdown-source-view") ||
                !(event.target instanceof Element)
            )
                return;
            const resolved = resolveExtractionTarget(
                event.target,
                container,
                context,
            );
            if (!resolved) return;
            const file = plugin.app.vault.getAbstractFileByPath(
                context.sourcePath,
            );
            if (!(file instanceof TFile)) return;
            event.preventDefault();
            event.stopPropagation();
            const menu = new Menu();
            addItem(menu, { file, ...resolved });
            menu.showAtMouseEvent(event);
        };
        // 하위 렌더러의 버블링 중단이나 DOM 교체에도 우클릭을 관찰합니다.
        container.addEventListener("contextmenu", onContextMenu, true);
        child.register(() =>
            container.removeEventListener("contextmenu", onContextMenu, true),
        );
    }, 1000);
}
