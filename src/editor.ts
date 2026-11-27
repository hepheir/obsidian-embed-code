import { editorInfoField, editorLivePreviewField } from "obsidian";
import {
    StateField,
    StateEffect,
    Prec,
    type EditorState,
    type Extension,
    type Range as DecorationRange,
} from "@codemirror/state";
import {
    Decoration,
    EditorView,
    WidgetType,
    type DecorationSet,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type CodeEmbed from "./main";
import { Embed } from "./embed";
import { supportsTarget } from "./settings";

export const refreshEmbedsEffect = StateEffect.define<void>();

export function createEditorExtension(plugin: CodeEmbed): Extension {
    // Obsidian의 기본 파일 임베드보다 먼저 치환합니다.
    return Prec.highest(
        StateField.define<DecorationSet>({
            create: (state) => buildDecorations(state, plugin),
            update: (decorations, transaction) => {
                if (
                    transaction.docChanged ||
                    transaction.selection ||
                    transaction.effects.length
                ) {
                    return buildDecorations(transaction.state, plugin);
                }
                return decorations;
            },
            provide: (field) => EditorView.decorations.from(field),
        }),
    );
}

function buildDecorations(
    state: EditorState,
    plugin: CodeEmbed,
): DecorationSet {
    if (
        !plugin.settings.enabled ||
        !state.field(editorLivePreviewField, false)
    ) {
        return Decoration.none;
    }
    const notePath = state.field(editorInfoField, false)?.file?.path ?? "";
    const decorations: DecorationRange<Decoration>[] = [];
    const embedPattern = /!\[\[([^\]\n]+)\]\]/g;
    const sourceText = state.doc.toString();
    for (const match of sourceText.matchAll(embedPattern)) {
        const from = match.index!;
        const to = from + match[0].length;
        if (!supportsTarget(match[1], plugin.settings)) {
            continue;
        }
        // 코드 예제나 주석 내부의 임베드 문법은 실행하지 않습니다.
        const syntaxNode = syntaxTree(state).resolveInner(from + 1, 1);
        let isExcludedContext = false;
        for (
            let node: typeof syntaxNode | null = syntaxNode;
            node;
            node = node.parent
        ) {
            if (/code|comment|frontmatter/i.test(node.name)) {
                isExcludedContext = true;
            }
        }
        if (
            isExcludedContext ||
            state.selection.ranges.some(
                (selection) => selection.from <= to && selection.to >= from,
            )
        ) {
            continue;
        }
        const line = state.doc.lineAt(from);
        const isStandaloneEmbed = line.text.trim() === match[0];
        decorations.push(
            Decoration.replace({
                widget: new EmbedWidget(plugin, match[1], notePath),
                block: isStandaloneEmbed,
            }).range(
                isStandaloneEmbed ? line.from : from,
                isStandaloneEmbed ? line.to : to,
            ),
        );
    }
    return Decoration.set(decorations, true);
}

class EmbedWidget extends WidgetType {
    private embed?: Embed;
    constructor(
        readonly plugin: CodeEmbed,
        readonly embedTarget: string,
        readonly notePath: string,
    ) {
        super();
    }

    eq(other: EmbedWidget): boolean {
        return (
            this.plugin === other.plugin &&
            this.embedTarget === other.embedTarget &&
            this.notePath === other.notePath
        );
    }

    toDOM(view: EditorView): HTMLElement {
        const container = document.createElement("span");
        this.embed = new Embed(
            container,
            this.plugin,
            this.embedTarget,
            this.notePath,
            () => {
                // 재사용된 위젯도 현재 문서의 위치로 변환합니다.
                const position = view.posAtDOM(container);
                const line = view.state.doc.lineAt(position);
                const matches = Array.from(
                    line.text.matchAll(/!\[\[([^\]\n]+)\]\]/g),
                );
                const match = matches.find((candidate) => {
                    const start = line.from + candidate.index!;
                    return (
                        candidate[1] === this.embedTarget &&
                        (start === position ||
                            (line.text.trim() === candidate[0] &&
                                position === line.from))
                    );
                });
                if (!match)
                    throw new Error("임베드 위치를 확인할 수 없습니다.");
                const from = line.from + match.index! + 3;
                view.dispatch({
                    selection: { anchor: from, head: from + match[1].length },
                    scrollIntoView: true,
                });
                view.focus();
            },
        );
        this.embed.load();
        const resizeObserver = new ResizeObserver(() => view.requestMeasure());
        resizeObserver.observe(container);
        this.embed.register(() => resizeObserver.disconnect());
        return container;
    }

    destroy() {
        this.embed?.unload();
    }

    ignoreEvent(): boolean {
        return true;
    }
}
