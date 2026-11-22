import { PluginSettingTab, Setting } from "obsidian";
import type CodeEmbed from "./main";
import { getFileExtension } from "./core";

export interface CodeEmbedSettings {
    enabled: boolean;
    extensions: string;
    lineNumbers: boolean;
    collapsed: boolean;
    wrap: boolean;
    refreshDelayMs: number;
}

const DEFAULT_SETTINGS: CodeEmbedSettings = {
    enabled: true,
    extensions:
        "py,js,ts,tsx,jsx,json,html,css,scss,java,c,cpp,h,hpp,cs,go,rs,rb,php,sh,bash,sql,yaml,yml,toml,xml,txt,md,swift,kt",
    lineNumbers: true,
    collapsed: false,
    wrap: false,
    refreshDelayMs: 300,
};

export function loadSettings(
    storedSettings: Partial<CodeEmbedSettings> | null,
): CodeEmbedSettings {
    // 알 수 없는 설정 항목은 제외하고, 빠진 값은 기본값으로 채웁니다.
    return {
        enabled: storedSettings?.enabled ?? DEFAULT_SETTINGS.enabled,
        extensions: storedSettings?.extensions ?? DEFAULT_SETTINGS.extensions,
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

export class EmbedSettings extends PluginSettingTab {
    constructor(readonly plugin: CodeEmbed) {
        super(plugin.app, plugin);
    }

    display() {
        const container = this.containerEl;
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
