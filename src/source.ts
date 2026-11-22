import type { DataAdapter } from "obsidian";
import { extractLines, type CodeSnippet, type LineRange } from "./core";

// 읽기가 끝나면 요청을 지워 다음 읽기에서 최신 파일을 가져옵니다.
export class SharedRequests<T> {
    private readonly pendingRequests = new Map<string, Promise<T>>();
    run(key: string, readSource: () => Promise<T>): Promise<T> {
        const existingRequest = this.pendingRequests.get(key);
        if (existingRequest) {
            return existingRequest;
        }
        const request = Promise.resolve().then(readSource);
        this.pendingRequests.set(key, request);
        const clearPendingRequest = () => {
            // 같은 키로 새 요청이 등록됐다면 이전 요청이 이를 지우지 않도록 합니다.
            if (this.pendingRequests.get(key) === request) {
                this.pendingRequests.delete(key);
            }
        };
        // 성공과 실패 모두 정리합니다. 읽기 오류는 원래 요청을 기다리는 쪽에 전달합니다.
        void request.then(clearPendingRequest, clearPendingRequest);
        return request;
    }

    invalidate(prefix?: string): void {
        if (prefix === undefined) {
            this.pendingRequests.clear();
        } else {
            for (const key of this.pendingRequests.keys()) {
                if (key.startsWith(prefix)) {
                    this.pendingRequests.delete(key);
                }
            }
        }
    }
}

export class CodeSource {
    private readonly pendingReads = new SharedRequests<CodeSnippet>();

    constructor(private readonly adapter: DataAdapter) {}

    read(path: string, range?: LineRange): Promise<CodeSnippet> {
        const requestKey = JSON.stringify([path, range]);
        return this.pendingReads.run(requestKey, async () => {
            const sourceText = await this.adapter.read(path);
            return extractLines(sourceText, range);
        });
    }

    invalidate(path?: string): void {
        // [경로, 범위] 키에서 쉼표까지 비교해야 이름이 비슷한 파일을 구분할 수 있습니다.
        const prefix =
            path === undefined
                ? undefined
                : JSON.stringify([path]).slice(0, -1) + ",";
        this.pendingReads.invalidate(prefix);
    }
}
