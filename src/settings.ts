import {
    AbstractInputSuggest,
    TFolder,
    PluginSettingTab,
    Setting,
    type App,
} from "obsidian";
import type CodeEmbed from "./main";
import { getFileExtension } from "./core";
import {
    normalizeExtractionDirectory,
    normalizeExtractionExtension,
} from "./extraction-core";

export interface CodeEmbedSettings {
    extractionVersion: number;
    extractionDirectory: string;
    extractionDefaultExtension: string;
    enabled: boolean;
    extensions: string;
    lineNumbers: boolean;
    collapsed: boolean;
    wrap: boolean;
    refreshDelayMs: number;
}

const DEFAULT_SETTINGS: CodeEmbedSettings = {
    extractionVersion: 1,
    extractionDirectory: "",
    extractionDefaultExtension: "txt",
    enabled: true,
    extensions:
        "py,js,ts,tsx,jsx,json,html,css,scss,java,c,cpp,h,hpp,cs,go,rs,rb,php,sh,bash,sql,yaml,yml,toml,xml,txt,md,mmd,swift,kt",
    lineNumbers: true,
    collapsed: false,
    wrap: false,
    refreshDelayMs: 300,
};

export function loadSettings(
    storedSettings: Partial<CodeEmbedSettings> | null,
): CodeEmbedSettings {
    // 알 수 없는 설정 항목은 제외하고, 빠진 값은 기본값으로 채웁니다.
    const extensions =
        storedSettings?.extensions ?? DEFAULT_SETTINGS.extensions;
    return {
        extractionVersion: 1,
        extractionDirectory: storedSettings?.extractionDirectory ?? "",
        extractionDefaultExtension:
            storedSettings?.extractionDefaultExtension ?? "txt",
        enabled: storedSettings?.enabled ?? DEFAULT_SETTINGS.enabled,
        extensions:
            storedSettings?.extractionVersion === 1 ||
            extensions
                .split(/[\s,]+/)
                .some((ext) => ext.replace(/^\./, "").toLowerCase() === "mmd")
                ? extensions
                : `${extensions},mmd`,
        lineNumbers:
            storedSettings?.lineNumbers ?? DEFAULT_SETTINGS.lineNumbers,
        collapsed: storedSettings?.collapsed ?? DEFAULT_SETTINGS.collapsed,
        wrap: storedSettings?.wrap ?? DEFAULT_SETTINGS.wrap,
        refreshDelayMs: isValidRefreshDelay(storedSettings?.refreshDelayMs)
            ? storedSettings.refreshDelayMs
            : DEFAULT_SETTINGS.refreshDelayMs,
    };
}

// 브라우저 타이머는 이 범위를 넘으면 지정한 시간보다 일찍 실행될 수 있습니다.
function isValidRefreshDelay(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 2_147_483_647
    );
}

export function supportsTarget(
    embedTarget: string,
    settings: CodeEmbedSettings,
): boolean {
    const path = embedTarget.split(/[|#]/)[0];
    return settings.extensions
        .split(/[\s,]+/)
        .map((extension) => extension.replace(/^\./, "").toLowerCase())
        .includes(getFileExtension(path));
}

// 공개 API로 기존 폴더의 부분 검색을 제공합니다.
class FolderSuggest extends AbstractInputSuggest<string> {
    constructor(
        private vaultApp: App,
        input: HTMLInputElement,
        save: (value: string) => void,
    ) {
        super(vaultApp, input);
        this.onSelect((value) => {
            this.setValue(value);
            save(value);
            this.close();
        });
    }
    getSuggestions(query: string): string[] {
        const search = query.trim().replace(/^\//, "").toLowerCase();
        return this.vaultApp.vault
            .getAllLoadedFiles()
            .filter(
                (file): file is TFolder =>
                    file instanceof TFolder && file.path !== "/",
            )
            .map((folder) => folder.path)
            .filter(
                (path) =>
                    !path.split("/").some((part) => part.startsWith(".")) &&
                    path.toLowerCase().includes(search),
            )
            .sort((a, b) => a.localeCompare(b));
    }
    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }
}

export class EmbedSettings extends PluginSettingTab {
    private folderSuggest?: FolderSuggest;
    hide() {
        this.folderSuggest?.close();
    }
    constructor(readonly plugin: CodeEmbed) {
        super(plugin.app, plugin);
    }

    display() {
        const container = this.containerEl;
        this.folderSuggest?.close();
        container.empty();
        container.createEl("h2", { text: "Embed Code" });
        const addToggleSetting = (
            name: string,
            key: "enabled" | "lineNumbers" | "collapsed" | "wrap",
        ) =>
            new Setting(container).setName(name).addToggle((control) =>
                control
                    .setValue(this.plugin.settings[key])
                    .onChange(async (value) => {
                        this.plugin.settings[key] = value;
                        await this.plugin.saveSettings(key === "enabled");
                    }),
            );
        addToggleSetting("임베드 활성화", "enabled");
        addToggleSetting("원본 행 번호 표시", "lineNumbers");
        addToggleSetting("기본으로 코드 접기", "collapsed");
        addToggleSetting("긴 행 줄바꿈", "wrap");
        new Setting(container)
            .setName("자동 갱신 대기 시간 (ms)")
            .setDesc(
                "마지막 파일 변경 후 기다릴 시간입니다. 기본값은 300ms이며 다음 파일 변경부터 적용합니다.",
            )
            .addText((control) => {
                control.inputEl.type = "number";
                control.inputEl.min = "0";
                control.inputEl.max = "2147483647";
                control.inputEl.step = "1";
                control.setValue(String(this.plugin.settings.refreshDelayMs));
                control.onChange(async (value) => {
                    const delay = Number(value);
                    const valid =
                        value.trim() !== "" && isValidRefreshDelay(delay);
                    control.inputEl.setCustomValidity(
                        valid ? "" : "0~2147483647 사이의 정수를 입력하세요.",
                    );
                    if (!valid) {
                        control.inputEl.reportValidity();
                        return;
                    }
                    this.plugin.settings.refreshDelayMs = delay;
                    // 대기 시간만 바뀌었으므로 코드를 다시 표시할 필요는 없습니다.
                    await this.plugin.saveData(this.plugin.settings);
                });
            });
        const addExtractionSetting = (
            name: string,
            description: string,
            key: "extractionDirectory" | "extractionDefaultExtension",
            normalize: (value: string) => string,
        ) => {
            new Setting(container)
                .setName(name)
                .setDesc(description)
                .addText((control) => {
                    control.setValue(this.plugin.settings[key]);
                    const save = (value: string) => {
                        try {
                            const normalized = normalize(value);
                            control.inputEl.setCustomValidity("");
                            this.plugin.settings[key] = normalized;
                            void this.plugin.saveData(this.plugin.settings);
                        } catch (error) {
                            control.inputEl.setCustomValidity(String(error));
                            control.inputEl.reportValidity();
                        }
                    };
                    control.onChange(save);
                    if (key === "extractionDirectory")
                        this.folderSuggest = new FolderSuggest(
                            this.app,
                            control.inputEl,
                            save,
                        );
                });
        };
        addExtractionSetting(
            "기본 저장 디렉터리",
            "Vault 루트 기준입니다. 빈 값은 Vault 루트이며, 없는 폴더는 추출할 때 생성합니다.",
            "extractionDirectory",
            normalizeExtractionDirectory,
        );
        addExtractionSetting(
            "기본 확장자",
            "코드 언어를 알 수 없을 때 사용합니다. 기본값은 txt이며 지원 확장자에도 포함되어야 합니다.",
            "extractionDefaultExtension",
            normalizeExtractionExtension,
        );
        new Setting(container)
            .setName("지원 확장자")
            .setDesc("쉼표로 구분합니다.")
            .addTextArea((control) =>
                control
                    .setValue(this.plugin.settings.extensions)
                    .onChange(async (value) => {
                        this.plugin.settings.extensions = value;
                        await this.plugin.saveSettings(true);
                    }),
            );
    }
}
