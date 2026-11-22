import { Plugin } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Embed, processReadingEmbeds } from "./embed";
import { createEditorExtension, refreshEmbedsEffect } from "./editor";
import { CodeSource } from "./source";
import {
    EmbedSettings,
    loadSettings,
    type CodeEmbedSettings,
} from "./settings";

export default class CodeEmbed extends Plugin {
    settings!: CodeEmbedSettings;
    readonly sourceReader = new CodeSource(this.app.vault.adapter);
    readonly activeEmbeds = new Set<Embed>();
    private readonly refreshTimers = new Map<
        string,
        ReturnType<typeof setTimeout>
    >();

    async onload(): Promise<void> {
        this.settings = loadSettings(await this.loadData());
        this.addSettingTab(new EmbedSettings(this));
        this.registerMarkdownPostProcessor((container, context) =>
            processReadingEmbeds(this, container, context),
        );
        this.registerEditorExtension(createEditorExtension(this));
        this.registerEvent(
            this.app.vault.on("modify", (file) =>
                this.scheduleSourceRefresh(file.path),
            ),
        );
        this.registerEvent(
            this.app.vault.on("create", (file) =>
                this.scheduleSourceRefresh(file.path),
            ),
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) =>
                this.scheduleSourceRefresh(file.path),
            ),
        );
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                this.scheduleSourceRefresh(oldPath);
                this.scheduleSourceRefresh(file.path);
            }),
        );
    }

    private scheduleSourceRefresh(path: string): void {
        const previousTimer = this.refreshTimers.get(path);
        if (previousTimer) {
            clearTimeout(previousTimer);
        }
        // 설정한 시간만큼 기다리는 동안에도 이전 읽기 결과가 화면에 반영되지 않도록 합니다.
        for (const embed of this.activeEmbeds) {
            if (embed.path === path) {
                embed.invalidate();
            }
        }
        this.sourceReader.invalidate(path);
        this.refreshTimers.set(
            path,
            setTimeout(() => {
                this.refreshTimers.delete(path);
                for (const embed of this.activeEmbeds) {
                    if (embed.path === path) {
                        void embed.render();
                    }
                }
            }, this.settings.refreshDelayMs),
        );
    }

    async saveSettings(rebuildEmbeds = false): Promise<void> {
        await this.saveData(this.settings);
        this.sourceReader.invalidate();
        // 표시 설정은 기존 화면만 갱신합니다. 활성화 여부나 확장자가 바뀌면 대상을 다시 찾습니다.
        if (!rebuildEmbeds) {
            for (const embed of this.activeEmbeds) {
                void embed.render();
            }
            return;
        }
        this.app.workspace.iterateAllLeaves((leaf) => {
            // 공개 타입에 없는 갱신 기능은 여기서만 내부 멤버에 접근해 사용합니다.
            const view = leaf.view as unknown as {
                editor?: { cm?: EditorView };
                previewMode?: { rerender: (force: boolean) => void };
            };
            view.editor?.cm?.dispatch({ effects: refreshEmbedsEffect.of() });
            view.previewMode?.rerender(true);
        });
    }

    onunload() {
        for (const timer of this.refreshTimers.values()) {
            clearTimeout(timer);
        }
        for (const embed of [...this.activeEmbeds]) {
            embed.unload();
        }
    }
}
