# Embed Code 아키텍처

Vault 내부 코드 파일을 읽기 모드와 라이브 프리뷰에 표시하는 TypeScript·pnpm 프로젝트다. 구조를 변경하기 전에 이 문서를 먼저 수정한다.

## 구성

```mermaid
flowchart TD
    Main[main.ts: 플러그인 등록과 파일 변경 처리] --> Settings[settings.ts: 설정값과 설정 화면]
    Main --> Editor[editor.ts: 라이브 프리뷰]
    Main --> Embed[embed.ts: 로딩과 화면 생성·해제]
    Editor --> Embed
    Embed --> Renderer[renderer.ts: 코드와 아이콘 표시]
    Embed --> Source[source.ts: 파일 읽기와 요청 공유]
    Source --> Core[core.ts: 문법과 행 처리]
    Renderer --> Core
    Tests[tests/core.test.ts: 핵심 단위 테스트] --> Core
    Tests --> Source
    Build[esbuild.config.ts] --> Dist[dist/embed-code: 설치 파일]
```

- `main.ts`는 각 모듈을 등록하고 파일 변경 후 갱신할 임베드를 찾는다.
- `settings.ts`는 기본 설정, 지원 확장자 확인, 설정 화면을 담당한다. 자동 갱신 대기 시간은 `refreshDelayMs`에 저장하며 기본값은 300ms다. 0 이상인 정수만 허용하고 타이머가 지원하는 최댓값을 넘으면 기본값을 사용한다. 변경한 값은 다음 파일 변경부터 적용한다.
- `editor.ts`는 라이브 프리뷰의 문법을 위젯으로 바꾸고 위젯이 사라질 때 임베드도 해제한다.
- `embed.ts`는 로딩과 오류를 표시하고 최신 읽기 결과만 화면에 반영한다.
- `renderer.ts`는 구문 강조, 행 번호, 줄바꿈, 아이콘을 표시한다.
- `source.ts`는 Vault 파일을 읽고 같은 경로와 행 범위의 진행 중인 요청을 공유한다.
- `core.ts`는 Obsidian에 의존하지 않는다. `LineRange`, `EmbedTarget`, `CodeSnippet`으로 입력과 추출 결과를 나타낸다. 행을 나눌 때 원본 줄바꿈을 보존한다.
- 경로는 임베드가 있는 노트의 폴더 기준이다. `/`로 시작하면 Vault 루트 기준이다. Vault 밖의 경로나 URL은 허용하지 않는다.
- 행 번호는 1부터 시작하고 양끝을 포함한다. 시작 행이 파일 끝을 넘으면 오류를 표시하고, 끝 행만 넘으면 마지막 행까지 읽는다. 마지막 줄바꿈은 추가 행으로 세지 않으며 빈 파일은 빈 첫 행으로 취급한다.

## 읽기와 갱신

```mermaid
sequenceDiagram
    participant View as 읽기 모드 / 라이브 프리뷰
    participant Embed as Embed
    participant Requests as CodeSource
    participant Vault
    View->>Embed: 대상 문법과 노트 경로
    Embed->>Embed: 요청 버전 증가 · 로딩 표시
    Embed->>Requests: 정규 경로 + 행 범위
    Requests->>Vault: 같은 요청이 진행 중이지 않으면 읽기
    Vault-->>Requests: 원본 문자열
    Requests-->>Embed: 추출한 코드와 원본 행 번호
    Embed->>View: 최신 요청일 때만 표시
    Vault->>Embed: main.ts에서 파일 변경을 받아 이전 요청 무효화
    Note over Embed: 마지막 변경 후 설정한 시간만큼 대기
    Embed->>Requests: 관련 임베드 다시 읽기
```

- 진행 중인 요청만 공유한다. 변경된 파일의 요청만 무효화하고, 이전 응답은 요청 버전으로 차단한다.
- 기본 파일 임베드와 충돌하지 않도록 라이브 프리뷰 치환을 높은 우선순위로 등록한다. 단독 행은 블록 위젯으로 표시하고 커서가 문법에 들어오면 편집할 수 있게 한다. 소스 모드는 치환하지 않는다.
- 코드를 한 번 강조하고, 줄바꿈과 행 번호를 함께 표시할 때는 강조된 DOM을 행별로 복제한다. 여러 줄 주석·문자열의 강조 문맥을 유지하기 위한 처리다.
- 표시 설정 변경은 기존 임베드만 갱신한다. 활성화 여부·지원 확장자 변경은 임베드 대상이 바뀌므로 읽기 화면과 에디터 치환을 다시 구성한다.
- `renderVersion`으로 오래된 응답을 걸러내고 `isUnloaded`로 화면이 닫혔는지 확인한다. 화면을 닫으면 구독과 ResizeObserver를 해제하고, 플러그인을 끄면 타이머도 정리한다.

## 화면 조작

파일명 오른쪽에 Obsidian 내장 아이콘 버튼으로 복사와 원본 열기를 배치한다. `setIcon`·`setTooltip`과 접근성 이름을 사용하고, 별도 버튼 줄은 만들지 않는다. 코드 배경과 모서리는 Obsidian 테마 변수를 따른다. 제목을 누르면 코드를 접거나 펼친다.

## 포맷팅

Prettier를 사용하며 들여쓰기는 탭 문자 대신 공백 4칸으로 통일한다. `pnpm format`은 코드와 문서를 정리하고 `pnpm format:check`는 형식만 검사한다. 빌드 산출물과 의존성 잠금 파일은 제외한다.

## 빌드와 검증

플러그인 ID와 설치 폴더 이름은 `embed-code`로 통일한다. 배포 ZIP은 `dist/embed-code.zip`에 둔다.

`pnpm build`는 미사용 변수·매개변수를 포함한 TypeScript 검사 후 설치 파일을 `dist/embed-code/`에 생성한다. `pnpm dev`도 같은 경로를 사용한다. Obsidian과 CodeMirror는 호스트가 제공하므로 번들에서 제외한다.

`pnpm test`는 행 범위, 원문 보존, 동시 요청 공유에 관한 핵심 단위 테스트만 실행한다.

## 자동 릴리즈

`main`에 push하면 GitHub Actions가 포맷, 핵심 테스트, 빌드를 검사한 뒤 semantic-release를 실행한다. 같은 브랜치의 배포는 한 번에 하나씩 실행한다.

```mermaid
flowchart LR
    Push[main push] --> Check[포맷 검사 · 테스트 · 빌드]
    Check --> Analyze[커밋으로 다음 버전 결정]
    Analyze --> Prepare[scripts/prepare-release.ts]
    Prepare --> Versions[package.json · manifest.json · versions.json]
    Prepare --> Build[버전 반영 후 빌드 · ZIP 생성]
    Build --> Commit[버전 파일과 CHANGELOG.md 자동 커밋]
    Commit --> Release[버전 태그 · GitHub Release · 파일 첨부]
```

`fix`는 패치, `feat`는 마이너, `!` 또는 `BREAKING CHANGE`는 메이저 버전을 올린다. 그 외 변경만 있으면 릴리즈하지 않는다. 첫 릴리즈는 `1.0.0`이다. 태그에는 `v`를 붙이지 않는다.

semantic-release 설정은 `release.config.cjs`에서 관리한다. 준비 스크립트는 버전 파일을 갱신하고 `dist/embed-code.zip`을 만든다. `versions.json`은 배포 버전별 최소 Obsidian 버전을 기록한다. 자동 커밋은 `[skip ci]`로 재실행을 막으며 본문은 한국어로 작성한다. GitHub Release에는 설치 파일 세 개와 ZIP을 첨부한다.

배포 권한은 GitHub Actions의 `GITHUB_TOKEN`을 사용한다. 토큰으로 생성한 태그가 다른 워크플로를 실행할 것으로 가정하지 않고, 같은 작업에서 파일 첨부까지 마친다.

## 코드 블록 파일 추출

```mermaid
flowchart LR
    Reading[읽기 화면 우클릭] --> UI[extract-ui.ts: 대상 식별과 메뉴·모달]
    Editor[라이브 프리뷰 캡처 이벤트 / editor-menu] --> UI
    UI --> Service[extraction.ts: 원문 추적·저장·치환]
    Service --> Core[extraction-core.ts: fence 파싱·변경 추적·경로 검증]
    Service --> Vault[Vault / 열린 노트 에디터]
```

UI는 `extraction-target.ts`의 공통 식별기로 원본 위치를 확인하고 공통 변환 서비스에 전달한다. 읽기 화면과 라이브 프리뷰는 안정적인 컨테이너에서 이벤트를 관찰하고, 우클릭 시점에 섹션 정보를 조회한다. 기본 pre·Mermaid와 Shiki/Expressive Code의 제목·행 번호를 포함한 블록 경계를 지원하며, 알 수 없는 렌더러는 섹션이 정확히 하나의 fence에 대응할 때만 허용한다. 라이브 프리뷰의 렌더링된 code·pre·외부 렌더러는 CodeMirror DOM의 캡처 이벤트에서 직접 메뉴를 열어 editor-menu 발생 여부에 의존하지 않는다. 일반 편집 영역은 기존 editor-menu를 사용한다. DOM 교체 후에도 원문 위치를 사용하며, 여러 fence가 섞인 모호한 섹션은 추측하지 않는다. 서비스는 DOM이나 마우스 이벤트에 의존하지 않으며 저장 설정으로 경로를 자동 생성한다. 설정의 저장 폴더는 Vault 루트 기준이며 빈 값은 루트다. 폴더 입력은 공개 AbstractInputSuggest API로 부분 검색을 제공한다. 파일명은 노트명_YYMMDDHHmmss.확장자이며 충돌 시 _2부터 번호를 붙인다. 알 수 없는 언어는 설정한 기본 확장자(txt)를 사용한다. 아이콘 버튼은 추가하지 않는다. Mermaid도 원본 fence를 추출하며 `.mmd` 임베드는 원문으로 표시한다.

저장 전에 원문과 경로를 검사하며 기존 파일은 덮어쓰지 않는다. 파일 저장 후에만 노트를 치환하며, 치환 실패 시 저장된 경로를 안내한다. 열린 에디터의 변경은 추적하고 대상에 닿은 변경은 변환을 중단한다. 실행 취소는 노트만 되돌린다.
