import { MarkdownView, TFile, TFolder, type Editor } from "obsidian";
import type CodeEmbed from "./main";
import {
    extractionPath,
    suggestedName,
    trackFence,
    type Fence,
} from "./extraction-core";
import { supportsTarget } from "./settings";

export interface ExtractionInput {
    file: TFile;
    text: string;
    fence: Fence;
}
export interface ExtractionPrompts {
    path(
        initial: string,
        validate: (value: string) => string | null,
    ): Promise<string | null>;
    overwrite(path: string): Promise<boolean>;
}

// UI는 입력과 확인을 담당하고, 저장과 노트 업데이트는 이 서비스에 모읍니다.
export class ExtractionService {
    private busy = false;
    private cancelled = false;
    constructor(private plugin: CodeEmbed) {
        plugin.register(() => {
            this.cancelled = true;
        });
    }

    async extract(
        input: ExtractionInput,
        prompts: ExtractionPrompts,
    ): Promise<void> {
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
            let initial = suggestedName(input.fence.language);
            let path: string;
            let existing: TFile | null;
            let previous: string | null;
            while (true) {
                if (this.cancelled)
                    throw Error("플러그인이 해제되어 추출을 중단했습니다.");
                const entered = await prompts.path(initial, (value) => {
                    try {
                        const target = extractionPath(value, input.file.path);
                        if (!supportsTarget(target, this.plugin.settings))
                            return "설정에서 지원하지 않는 확장자입니다.";
                        if (
                            app.vault.getAbstractFileByPath(target) instanceof
                            TFolder
                        )
                            return "같은 경로에 폴더가 있습니다.";
                        return null;
                    } catch (error) {
                        return String(error);
                    }
                });
                if (entered === null) return;
                path = extractionPath(entered, input.file.path);
                const target = app.vault.getAbstractFileByPath(path);
                if (target && !(target instanceof TFile))
                    throw Error("저장 경로에 폴더가 있습니다.");
                existing = target;
                previous = existing ? await app.vault.read(existing) : null;
                if (!existing || (await prompts.overwrite(path))) break;
                initial = entered;
            }
            await validateSource();
            const parts = path.split("/");
            for (let i = 1; i < parts.length; i++) {
                const folder = parts.slice(0, i).join("/");
                if (!app.vault.getAbstractFileByPath(folder))
                    await app.vault.createFolder(folder);
            }
            await validateSource();
            if (existing instanceof TFile) {
                if (app.vault.getAbstractFileByPath(path) !== existing)
                    throw Error("저장 대상이 변경되었습니다.");
                await app.vault.process(existing, (contents) => {
                    if (contents !== previous)
                        throw Error(
                            "덮어쓰기 대상이 변경되었습니다. 다시 시도하세요.",
                        );
                    return input.fence.code;
                });
            } else {
                await app.vault.create(path, input.fence.code);
            }
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
