"use client";

// 서류 올리기 칸 — 사업자 정보 맨 위. 서류를 끌어 놓거나 눌러 고르면 서버가 읽어 칸을 채워 준다.
// 이 파일은 「올리는 일」(useDocumentUpload)과 「그리는 일」(DocumentUploadBox)만 한다.
// 읽은 결과를 칸에 합치는 일은 ProfileForm 이 한다(applyDocumentFields).
import { useRef, useState, type DragEvent } from "react";
import {
  DOCUMENT_UPLOAD_LIMITS,
  type DocumentFileResult,
  type DocumentPrefillResult,
} from "../../documents/types";
import type { DocumentPrefillResponse } from "./endpoints";
import {
  FORMAT_CARDS,
  attachNoticeOf,
  READABLE_DOCUMENT_LABELS,
  checkUploadSelection,
  fileKindOf,
  fileStatusText,
  type FileKind,
} from "./document-prefill";

const MB = 1024 * 1024;

const UPLOAD_FAILED = "서류를 읽지 못했어요 — 잠시 뒤 다시 올려 주세요";
const NETWORK_FAILED = "서류를 올리지 못했어요 — 연결을 확인하고 다시 올려 주세요";

/** 올린 파일 한 줄 — 서버가 파일마다 돌려준 결과에 목록용 번호를 붙인 것. */
export interface UploadedFile {
  id: number;
  result: DocumentFileResult;
}

interface UploadOptions {
  /** `POST {endpoint}` multipart. 없으면 올리지 않는다 */
  endpoint: string | undefined;
  /** 고객을 불러온 상태면 그 열쇠 — 서버가 올린 서류를 그 고객 자료에 붙인다 */
  customerKey: string;
  /** 읽은 결과가 오면 부른다(칸에 합치는 일) */
  onResult: (result: DocumentPrefillResult) => void;
}

/**
 * 서류를 서버로 올리고 읽은 결과를 받는 상태 묶음.
 * 개수·크기는 서버에 보내기 전에 화면에서 먼저 막고, 서버가 실패를 알리면 서버 안내 문구를 그대로 보인다.
 * 올리는 도중에 칸 값이 바뀔 수 있어 결과를 받는 쪽·고객 열쇠는 「가장 최근 것」을 ref 로 읽는다.
 * 올릴 때마다 차례 번호를 받고, 고객을 새로 불러오거나 비울 때(reset) 번호를 올려 진행 중인 요청을 끊는다 —
 * 번호가 달라진 뒤에 도착한 응답은 버린다(앞 고객 서류가 새 고객 칸을 덮어쓰면 안 된다).
 */
export function useDocumentUpload({ endpoint, customerKey, onResult }: UploadOptions) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attached, setAttached] = useState(false);
  const [attachNote, setAttachNote] = useState(""); // 못 붙였거나 일부를 뺀 이유 — attached 와 함께 마지막으로 올린 결과 기준
  const seq = useRef(0); // 목록 줄 번호
  const run = useRef(0); // 올리기 차례 번호 — reset 이 올린다
  const inflight = useRef<AbortController | null>(null);
  const latest = useRef({ customerKey, onResult });
  latest.current = { customerKey, onResult };

  const upload = async (picked: readonly File[]) => {
    if (!endpoint || picked.length === 0) return;
    const warn = checkUploadSelection(picked);
    if (warn) {
      setError(warn);
      return;
    }
    const mine = ++run.current;
    const controller = new AbortController();
    inflight.current = controller;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      for (const f of picked) form.append("files", f);
      if (latest.current.customerKey) form.append("customerKey", latest.current.customerKey);
      const res = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
      const j = (await res.json()) as DocumentPrefillResponse | null;
      if (mine !== run.current) return; // 그 사이 고객이 바뀌었다 — 늦게 온 답은 버린다
      if (!j || !j.success) {
        setError((j && !j.success && j.error?.message) || UPLOAD_FAILED);
        return;
      }
      setFiles((prev) => [...prev, ...j.data.files.map((result) => ({ id: ++seq.current, result }))]);
      // 붙이기 안내는 마지막으로 올린 결과만 따른다 — 앞 성공이 남아 다음 실패와 함께 보이면 헷갈린다.
      const notice = attachNoticeOf(j.data);
      setAttached(notice.attached);
      setAttachNote(notice.note);
      latest.current.onResult(j.data);
    } catch {
      if (mine !== run.current) return; // 끊은 요청의 오류는 알리지 않는다
      setError(NETWORK_FAILED);
    } finally {
      if (mine === run.current) {
        inflight.current = null;
        setBusy(false);
      }
    }
  };

  /** 목록에서만 뺀다 — 이미 채운 칸의 값은 그대로 둔다. */
  const remove = (id: number) => setFiles((prev) => prev.filter((f) => f.id !== id));

  /** 고객을 새로 불러오면 앞 고객의 서류 목록도 함께 비운다. 올리는 중이던 요청은 끊고 그 답은 버린다. */
  const reset = () => {
    run.current++;
    inflight.current?.abort();
    inflight.current = null;
    setBusy(false);
    setFiles([]);
    setError("");
    setAttached(false);
    setAttachNote("");
  };

  return { files, busy, error, attached, attachNote, upload, remove, reset };
}

/** 형식 표식 바탕 — 기존 WEDLY 토큰 색만 쓴다. */
const KIND_BG: Record<FileKind, string> = {
  PDF: "bg-wedly-red",
  XLS: "bg-wedly-green",
  HWP: "bg-wedly-accent",
  DOC: "bg-wedly-t1",
  IMG: "bg-wedly-orange",
  FILE: "bg-wedly-muted",
};
const KIND_BADGE = "inline-flex shrink-0 items-center justify-center rounded text-xs font-bold text-white";

interface BoxProps {
  files: UploadedFile[];
  busy: boolean;
  error: string;
  /** 올린 서류를 고객 자료에 붙여 뒀다고 서버가 알렸는가 */
  attached: boolean;
  /** 못 붙였거나 일부 파일을 빼고 붙인 이유 — 비면 안 보인다 */
  attachNote?: string;
  /** 안내 방식 — attach(기본): 고객 자료에 붙여 둠 · lab: 저장 안 함, 사진은 글자 있는 PDF로 */
  mode?: "attach" | "lab";
  onPick: (files: File[]) => void;
  onRemove: (id: number) => void;
}

export default function DocumentUploadBox({ files, busy, error, attached, attachNote = "", mode = "attach", onPick, onRemove }: BoxProps) {
  const [hot, setHot] = useState(false);
  const lab = mode === "lab";
  const { maxFiles, maxFileBytes, acceptExtensions } = DOCUMENT_UPLOAD_LIMITS;

  const pick = (list: File[]) => {
    if (busy) return;
    onPick(list);
  };

  return (
    <div data-k="documents" className="mt-4">
      {/* 칸 전체가 눌러 고르는 자리 — 안의 숨은 입력이 키보드로도 닿고, 끌어 놓기도 여기서 받는다. */}
      <label
        className={`block cursor-pointer rounded-xl border-[1.5px] border-dashed p-4 text-center transition-colors focus-within:ring-2 focus-within:ring-wedly-accent ${
          hot ? "border-wedly-accent bg-wedly-bg-blue" : "border-wedly-accent/40 bg-wedly-bg-gray"
        }`}
        onDragOver={(e: DragEvent<HTMLLabelElement>) => {
          e.preventDefault();
          setHot(true);
        }}
        onDragLeave={() => setHot(false)}
        onDrop={(e: DragEvent<HTMLLabelElement>) => {
          e.preventDefault();
          setHot(false);
          pick(Array.from(e.dataTransfer?.files ?? []));
        }}
      >
        <span className="block text-sm font-semibold leading-[22px] text-wedly-t1">서류를 올리면 칸을 채워 드려요</span>
        <span className="mt-1 block text-xs leading-[18px] text-wedly-t2">
          여기로 끌어 놓거나 눌러서 고르세요 · 여러 개 한 번에
        </span>
        <input
          type="file"
          multiple
          accept={acceptExtensions.join(",")}
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = ""; // 같은 파일을 다시 골라도 변경으로 잡히게 비운다
            pick(picked);
          }}
        />

        <span className="mt-4 grid grid-cols-5 gap-1.5">
          {FORMAT_CARDS.map((c) => (
            <span
              key={c.kind}
              data-fmt={c.kind}
              className="flex flex-col items-center gap-1 rounded-lg border border-wedly-bd bg-white px-1 py-1.5"
            >
              <span className={`${KIND_BADGE} h-6 w-8 ${KIND_BG[c.kind]}`}>{c.kind}</span>
              <span className="text-xs font-semibold leading-[18px] text-wedly-t1">{c.name}</span>
              <span className="text-xs leading-[18px] text-wedly-muted">{c.exts}</span>
              {lab && c.kind === "IMG" && (
                <span className="text-xs font-semibold leading-[18px] text-wedly-accent">글자 있는 PDF로</span>
              )}
            </span>
          ))}
        </span>
        <span className="mt-2 block text-xs leading-[18px] text-wedly-t2">
          {`한 번에 ${maxFiles}개 · 파일당 ${maxFileBytes / MB}MB · 옛 한글(.hwp)은 PDF로 저장해 올려 주세요`}
        </span>

        <span className="mt-2 block text-xs leading-[18px] text-wedly-t2">이런 서류를 읽어요</span>
        <span className="mt-1 flex flex-wrap justify-center gap-1">
          {READABLE_DOCUMENT_LABELS.map((name) => (
            <span
              key={name}
              data-kind={name}
              className="rounded-full border border-wedly-bd bg-white px-2 text-xs leading-[18px] text-wedly-t2"
            >
              {name}
            </span>
          ))}
        </span>
      </label>

      {busy && (
        <div role="status" className="mt-2 text-xs leading-[18px] text-wedly-t2">
          서류를 읽는 중이에요…
          <div className="mt-1 h-1 w-full animate-pulse rounded bg-wedly-accent" />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs leading-[18px] text-wedly-red">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul aria-label="올린 서류" className="mt-2 flex flex-col gap-1.5">
          {files.map(({ id, result }) => {
            const kind = fileKindOf(result.name);
            const ok = result.status === "read" || result.status === "read-by-ai";
            return (
              <li
                key={id}
                data-file={result.name}
                className="flex items-center gap-2 rounded-lg border border-wedly-bd bg-white px-2 py-1.5"
              >
                <span className={`${KIND_BADGE} h-6 w-6 ${KIND_BG[kind]}`}>{kind === "FILE" ? "…" : kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-[22px] text-wedly-t1">{result.name}</span>
                  <span className={`block truncate text-xs leading-[18px] ${ok ? "text-wedly-green-ink" : "text-wedly-muted"}`}>
                    {fileStatusText(result)}
                  </span>
                </span>
                <button
                  type="button"
                  title="빼기"
                  aria-label={`${result.name} 빼기`}
                  onClick={() => onRemove(id)}
                  className="rounded px-1 text-base leading-6 text-wedly-muted transition-colors hover:text-wedly-t1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p data-doc-note={mode} className="mt-2 text-xs leading-[18px] text-wedly-t2">
        {lab
          ? "서류를 저장하지 않아요. 사진·스캔본은 글자 있는 PDF로 올려 주세요"
          : "고객을 불러온 상태면 올린 서류를 그 고객 자료에 붙여 둡니다"}
      </p>
      {!lab && attached && (
        <p className="mt-1 text-xs leading-[18px] text-wedly-green-ink">올린 서류를 고객 자료에 붙여 두었습니다</p>
      )}
      {!lab && attachNote && (
        <p data-doc-attach-note className={`mt-1 text-xs leading-[18px] ${attached ? "text-wedly-t2" : "text-wedly-red-ink"}`}>
          {attachNote}
        </p>
      )}
    </div>
  );
}
