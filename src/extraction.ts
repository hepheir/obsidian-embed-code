import { MarkdownView, TFile, TFolder, type Editor } from "obsidian";
import type CodeEmbed from "./main";
import {
    automaticExtractionPath,
    trackFence,
    type Fence,
} from "./extraction-core";
import { supportsTarget } from "./settings";

export interface ExtractionInput {
    file: TFile;
    text: string;
    fence: Fence;
}
// 저장 후에만 원문을 치환하도록 저장과 노트 업데이트를 모읍니다.
export class ExtractionService {
    private busy = false;
    private cancelled = false;
    constructor(private plugin: CodeEmbed) {
        plugin.register(() => {
            this.cancelled = true;
        });
    }

    async extract(input: ExtractionInput): Promise<void> {
        if (this.busy) throw Error("다른 추출 작업이 진행중입니다.");
        this.busy = true;
        const { app } = this.plugin;
        let text = input.text;
        let fence: Fence | null = input.fence;
        const update = (next: string) => {
            if (fence) fence = trackFence(text, next, fence);
            text = next;
        };
        const event = app.workspace.on("editor-change", (editor, info) => {
            if (info.file === input.file) update(editor.getValue());
        });
        const currentEditor = () => {
            let editor: Editor | undefined;
            app.workspace.iterateAllLeaves((leaf) => {
                if (
                    leaf.view instanceof MarkdownView &&
                    leaf.view.file === input.file
                )
                    editor = leaf.view.editor;
            });
            return editor;
        };
        const validateSource = async () => {
            if (this.cancelled)
                throw Error("플러그인이 해제되어 추출을 중단했습니다.");
            if (app.vault.getAbstractFileByPath(input.file.path) !== input.file)
                throw Error("원본 노트가 삭제되었습니다.");
            const editor = currentEditor();
            update(
                editor ? editor.getValue() : await app.vault.read(input.file),
            );
            if (!fence || text.slice(fence.from, fence.to) !== input.fence.raw)
                throw Error("대상 코드가 변경되었습니다. 다시 시도하세요.");
        };
        let savedPath: string | undefined;
        try {
            const basePath = automaticExtractionPath(
                input.file.path,
                input.fence.language,
                this.plugin.settings.extractionDirectory,
                this.plugin.settings.extractionDefaultExtension,
                new Date(),
            );
            if (!supportsTarget(basePath, this.plugin.settings))
                throw Error(
                    "설정에서 지원하지 않는 확장자입니다. 지원 확장자 설정을 확인하세요.",
                );
            const uniquePath = () => {
                let candidate = basePath;
                let suffix = 2;
                const dot = basePath.lastIndexOf(".");
                while (app.vault.getAbstractFileByPath(candidate))
                    candidate = `${basePath.slice(0, dot)}_${suffix++}${basePath.slice(dot)}`;
                return candidate;
            };
            let path = uniquePath();
            await validateSource();
            const parts = path.split("/");
            for (let i = 1; i < parts.length; i++) {
                const folder = parts.slice(0, i).join("/");
                const existing = app.vault.getAbstractFileByPath(folder);
                if (existing && !(existing instanceof TFolder))
                    throw Error("저장 폴더 경로에 파일이 있습니다.");
                if (!existing) await app.vault.createFolder(folder);
            }
            await validateSource();
            path = uniquePath();
            await app.vault.create(path, input.fence.code);
            savedPath = path;
            await validateSource();
            const replacement = `${input.fence.prefix}![[/${path}]]`;
            const editor = currentEditor();
            if (editor && fence) {
                editor.transaction({
                    changes: [
                        {
                            from: editor.offsetToPos(fence.from),
                            to: editor.offsetToPos(fence.to),
                            text: replacement,
                        },
                    ],
                });
            } else {
                await app.vault.process(input.file, (contents) => {
                    update(contents);
                    if (
                        !fence ||
                        contents.slice(fence.from, fence.to) !== input.fence.raw
                    )
                        throw Error("대상 코드가 변경되었습니다.");
                    return (
                        contents.slice(0, fence.from) +
                        replacement +
                        contents.slice(fence.to)
                    );
                });
            }
        } catch (error) {
            throw Error(
                savedPath
                    ? `${savedPath}에 저장했지만 노트 치환에 실패했습니다: ${String(error)}`
                    : String(error),
            );
        } finally {
            app.workspace.offref(event);
            this.busy = false;
        }
    }
}
