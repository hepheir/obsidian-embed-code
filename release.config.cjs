/** @type {import("semantic-release").GlobalConfig} */
module.exports = {
    branches: ["main"],
    tagFormat: "${version}",
    plugins: [
        [
            "@semantic-release/commit-analyzer",
            {
                preset: "conventionalcommits",
                releaseRules: [
                    { breaking: true, release: "major" },
                    { type: "feat", release: "minor" },
                    { type: "fix", release: "patch" },
                    // 호환성 변경이 없다면 feat와 fix 이외의 커밋은 배포하지 않습니다.
                    { type: "!(feat|fix)", release: false },
                ],
            },
        ],
        [
            "@semantic-release/release-notes-generator",
            { preset: "conventionalcommits" },
        ],
        "@semantic-release/changelog",
        [
            "@semantic-release/exec",
            {
                prepareCmd:
                    'pnpm exec tsx scripts/prepare-release.ts "${nextRelease.version}"',
            },
        ],
        [
            "@semantic-release/git",
            {
                assets: [
                    "package.json",
                    "manifest.json",
                    "versions.json",
                    "CHANGELOG.md",
                ],
                message:
                    "chore(release): ${nextRelease.version} [skip ci]\n\n- 플러그인 버전과 변경 내역을 갱신합니다.",
            },
        ],
        [
            "@semantic-release/github",
            {
                assets: [
                    "dist/embed-code/main.js",
                    "dist/embed-code/manifest.json",
                    "dist/embed-code/styles.css",
                    "dist/embed-code.zip",
                ],
                successComment: false,
                failComment: false,
                releasedLabels: false,
            },
        ],
    ],
};
