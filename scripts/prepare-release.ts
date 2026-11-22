import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

interface VersionedFile {
    version: string;
    [key: string]: unknown;
}

interface PluginManifest extends VersionedFile {
    minAppVersion: string;
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 4) + "\n");
}

function prepareRelease(version: string | undefined): void {
    // 태그와 Obsidian manifest에 같은 정식 버전 번호를 사용합니다.
    if (
        !version ||
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    ) {
        throw new Error("릴리즈 버전은 1.2.3 형식이어야 합니다.");
    }

    const packageJson = readJson<VersionedFile>("package.json");
    const manifest = readJson<PluginManifest>("manifest.json");
    const versions = readJson<Record<string, string>>("versions.json");
    packageJson.version = version;
    manifest.version = version;
    versions[version] = manifest.minAppVersion;

    writeJson("package.json", packageJson);
    writeJson("manifest.json", manifest);
    writeJson("versions.json", versions);

    const versionFiles = ["package.json", "manifest.json", "versions.json"];
    if (existsSync("CHANGELOG.md")) {
        versionFiles.push("CHANGELOG.md");
    }
    execFileSync("pnpm", ["exec", "prettier", "--write", ...versionFiles], {
        stdio: "inherit",
    });

    // 이전 산출물이 ZIP에 섞이지 않도록 설치 폴더와 압축 파일만 비웁니다.
    rmSync("dist/embed-code", { recursive: true, force: true });
    rmSync("dist/embed-code.zip", { force: true });
    execFileSync("pnpm", ["build"], { stdio: "inherit" });
    execFileSync("zip", ["-qr", "embed-code.zip", "embed-code"], {
        cwd: "dist",
        stdio: "inherit",
    });
}

try {
    prepareRelease(process.argv[2]);
} catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
}
