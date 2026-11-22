import esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

async function build(): Promise<void> {
    const outputDirectory = "dist/embed-code";
    // 빌드와 개발 모드 모두 바로 설치할 수 있는 동일한 폴더를 만듭니다.
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all(
        ["manifest.json", "styles.css"].map((fileName) =>
            copyFile(fileName, `${outputDirectory}/${fileName}`),
        ),
    );
    // 호스트가 제공하는 모듈은 번들에 포함하지 않아 CM6 인스턴스 충돌을 방지합니다.
    const buildContext = await esbuild.context({
        entryPoints: ["src/main.ts"],
        bundle: true,
        external: [
            "obsidian",
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/language",
        ],
        format: "cjs",
        target: "es2020",
        outdir: outputDirectory,
    });
    if (process.argv.includes("--watch")) {
        await buildContext.watch();
    } else {
        await buildContext.rebuild();
        await buildContext.dispose();
    }
}

void build().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
