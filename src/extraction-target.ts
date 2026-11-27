import { findFences, type Fence } from "./extraction-core";

interface Section {
    text: string;
    lineStart: number;
    lineEnd: number;
}
export interface SectionContext {
    getSectionInfo(element: HTMLElement): Section | null;
}

const blockSelector =
    ".expressive-code, .shiki, pre, .mermaid, [class*='block-language-']";

// 화면 텍스트 대신 현재 섹션과 원문으로 대상을 식별합니다.
export function resolveExtractionTarget(
    target: Element,
    container: HTMLElement,
    context: SectionContext,
): { text: string; fence: Fence } | null {
    if (!container.contains(target) || target.closest(".code-embed"))
        return null;
    const known = target.closest(blockSelector);
    // Expressive Code의 제목과 행 번호도 같은 블록으로 취급합니다.
    const rendered = known?.closest(".expressive-code") ?? known;
    for (
        let node = target;
        node && container.contains(node);
        node = node.parentElement!
    ) {
        const section = context.getSectionInfo(node as HTMLElement);
        if (section) {
            const blocks = findFences(section.text).filter(
                (fence) =>
                    fence.lineStart >= section.lineStart &&
                    fence.lineEnd <= section.lineEnd,
            );
            if (blocks.length === 1) {
                const fence = blocks[0];
                const exact =
                    fence.lineStart === section.lineStart &&
                    fence.lineEnd === section.lineEnd;
                if ((rendered && container.contains(rendered)) || exact)
                    return { text: section.text, fence };
            }
        }
        if (node === container) break;
    }
    return null;
}
