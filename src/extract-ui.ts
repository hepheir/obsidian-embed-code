import {
    MarkdownRenderChild,
    Menu,
    Notice,
    TFile,
    editorInfoField,
    editorLivePreviewField,
    type MarkdownPostProcessorContext,
} from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type CodeEmbed from "./main";
import { findFences } from "./extraction-core";
import { resolveExtractionTarget } from "./extraction-target";
import { ExtractionService, type ExtractionInput } from "./extraction";

export function registerExtraction(plugin: CodeEmbed): void {
    const service = new ExtractionService(plugin);
    const sections = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
    const children = new Set<MarkdownRenderChild>();
    plugin.register(() => {
        for (const child of children) child.unload();
    });
    const addItem = (menu: Menu, input: ExtractionInput) => {
        menu.addItem((item) =>
            item
                .setTitle("파일로 추출")
                .setIcon("file-output")
                .onClick(() => {
                    void service
                        .extract(input)
                        .catch((error: unknown) => new Notice(String(error)));
                }),
        );
    };
    // 외부 렌더러에서는 Obsidian의 editor-menu가 발생하지 않을 수 있습니다.
    plugin.registerEditorExtension(
        ViewPlugin.fromClass(
            class {
                private readonly onContextMenu = (event: MouseEvent) => {
                    clicked = undefined;
                    const view = this.view;
                    if (
                        !plugin.settings.enabled ||
                        !view.state.field(editorLivePreviewField, false) ||
                        !(event.target instanceof Element) ||
                        !event.target.closest(
                            "code, pre, .expressive-code, .shiki, .mermaid, [class*='block-language-']",
                        ) ||
                        event.target.closest(".code-embed")
                    )
                        return;
                    const info = view.state.field(editorInfoField, false);
                    if (!info?.file) return;
                    const text = view.state.doc.toString();
                    let input: ExtractionInput | undefined;
                    let hasContext = false;
                    for (
                        let node: Element | null = event.target;
                        node && view.dom.contains(node);
                        node = node.parentElement
                    ) {
                        const context = sections.get(node as HTMLElement);
                        if (!context) continue;
                        hasContext = true;
                        const resolved = resolveExtractionTarget(
                            event.target,
                            node as HTMLElement,
                            context,
                        );
                        if (resolved?.text === text)
                            input = { file: info.file, ...resolved };
                        break;
                    }
                    if (!hasContext) {
                        // Shiki의 CM6 강조는 post processor 없이 mark decoration으로 생성됩니다.
                        let offset = view.posAtCoords({
                            x: event.clientX,
                            y: event.clientY,
                        });
                        if (offset === null) {
                            try {
                                offset = view.posAtDOM(event.target);
                            } catch {
                                return;
                            }
                        }
                        const fence = findFences(text).find(
                            (block) =>
                                block.from <= offset! && offset! < block.to,
                        );
                        if (fence) input = { file: info.file, text, fence };
                    }
                    if (!input) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const menu = new Menu();
                    addItem(menu, input);
                    menu.showAtMouseEvent(event);
                };
                constructor(private readonly view: EditorView) {
                    view.dom.addEventListener(
                        "contextmenu",
                        this.onContextMenu,
                        true,
                    );
                }
                destroy() {
                    this.view.dom.removeEventListener(
                        "contextmenu",
                        this.onContextMenu,
                        true,
                    );
                }
            },
        ),
    );
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
