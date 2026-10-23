"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { MaterialRow, UploadRow, type UploadItem } from "@/components/materials/material-row";
import { DeleteMaterialDialog, RenameMaterialDialog } from "@/components/materials/material-dialogs";
import { PagesDialog } from "@/components/materials/pages-dialog";
import { UploadDropzone } from "@/components/materials/upload-dropzone";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { getCourse, type Course } from "@/lib/courses";
import {
  getVisionStatus,
  isReadingPictures,
  isWorking,
  listMaterials,
  retryFailedPages,
  retryMaterial,
  uploadMaterial,
  type Material,
  type ProcessingMode,
  type ReaderStatus,
} from "@/lib/materials";

/*
  /courses/[id]: one course and its files.
  The folder is called [id], a DYNAMIC route: one page file serves every
  course, and useParams() gives us the id from the URL.

  The life of an upload, as the student sees it:
    1. drop a PDF          -> "Uploading 45%"   (XMLHttpRequest progress)
    2. backend answers 202 -> "Queued"          (row exists, status pending)
    3. a worker picks it   -> "Reading page 12 of 41"
    4. done                -> "Ready · 41 pages · 42 passages"
    5. picture pages       -> "Reading pictures · 7 of 19 pages"   (Stage 5b)
  Steps 2-5 happen on the server; the browser asks again (POLLING) every
  1.5 s while a file's text is being read, every 5 s while only pictures
  are (that takes minutes, not seconds), and stops when all are done.
*/

const POLL_MS = 1500;
const PICTURE_POLL_MS = 5000;
const MODE_KEY = "studymate:processing-mode";

// The last Smart/Thorough choice, remembered in this browser only.
// localStorage can throw (private mode, blocked storage): then just Smart.
function savedMode(): ProcessingMode {
  try {
    return localStorage.getItem(MODE_KEY) === "thorough" ? "thorough" : "smart";
  } catch {
    return "smart";
  }
}

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ready" };

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [viewing, setViewing] = useState<Material | null>(null);
  const [renaming, setRenaming] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [mode, setMode] = useState<ProcessingMode>("smart");
  const [reader, setReader] = useState<ReaderStatus | null>(null);

  // Read the saved mode after the first render: localStorage doesn't exist on
  // the server, so reading it during render would make server and browser
  // HTML differ (a hydration mismatch).
  useEffect(() => {
    const saved = savedMode();
    if (saved !== "smart") queueMicrotask(() => setMode(saved));
  }, []);

  function changeMode(next: ProcessingMode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* not remembered; fine */
    }
  }

  // ---- First load: the course and its files, at the same time ----------
  useEffect(() => {
    let alive = true;
    Promise.all([getCourse(id), listMaterials(id)])
      .then(([c, list]) => {
        if (!alive) return;
        setCourse(c);
        setMaterials(list);
        setLoad({ state: "ready" });
      })
      .catch((err) => {
        if (!alive) return;
        // 404 = not your course (or it doesn't exist): the backend doesn't say which
        if (err instanceof ApiError && err.status === 404) setLoad({ state: "missing" });
        else setLoad({ state: "error", message: err instanceof ApiError ? err.message : "Couldn't open this course." });
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  // ---- Polling: only while something is still being read --------------
  // A ref holds the latest list so the timer callback can compare old vs new
  // without restarting the timer on every change.
  const latest = useRef<Material[]>([]);
  useEffect(() => {
    latest.current = materials;
  }, [materials]);

  const anyWorking = materials.some(isWorking);
  const anyPictures = materials.some(isReadingPictures);
  useEffect(() => {
    if (!anyWorking && !anyPictures) return;
    const tick = () => {
      if (anyPictures) getVisionStatus().then(setReader).catch(() => {});
      listMaterials(id)
        .then((list) => {
          // Tell screen readers when a file finishes.
          for (const m of list) {
            const before = latest.current.find((x) => x.id === m.id);
            if (before && isWorking(before) && !isWorking(m)) {
              setAnnouncement(m.status === "ready" ? `${m.title} is ready.` : `${m.title} couldn't be read.`);
            }
          }
          setMaterials(list);
        })
        .catch(() => {}); // a missed poll is fine; the next one tries again
    };
    if (anyPictures) tick(); // the reader's status at once, not after 5 s
    const timer = setInterval(tick, anyWorking ? POLL_MS : PICTURE_POLL_MS);
    return () => clearInterval(timer); // stop when nothing is working or we leave the page
  }, [anyWorking, anyPictures, id]);

  // ---- Uploading --------------------------------------------------------
  const patchUpload = useCallback((key: string, patch: Partial<UploadItem>) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }, []);

  async function startUploads(files: File[], rejected: { name: string; reason: string }[]) {
    setNotice(rejected.length ? rejected.map((r) => `${r.name}: ${r.reason}`).join(" ") : null);
    // One file at a time: simpler progress, and the server reads them in order anyway.
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const { promise, abort } = uploadMaterial(id, file, mode, (p) => patchUpload(key, { progress: p }));
      setUploads((list) => [...list, { key, name: file.name, size: file.size, progress: 0, error: null, abort }]);
      try {
        const created = await promise;
        setUploads((list) => list.filter((u) => u.key !== key));
        setMaterials((list) => [created, ...list.filter((m) => m.id !== created.id)]);
      } catch (err) {
        if (err instanceof ApiError && err.status === -1) {
          setUploads((list) => list.filter((u) => u.key !== key)); // cancelled by the user
        } else {
          patchUpload(key, { error: err instanceof ApiError ? err.message : "Upload failed." });
        }
      }
    }
  }

  async function onRetry(m: Material) {
    try {
      const updated = await retryMaterial(m.id);
      setMaterials((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Couldn't retry.");
    }
  }

  async function onRetryPages(m: Material) {
    try {
      const updated = await retryFailedPages(m.id);
      setMaterials((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Couldn't retry those pages.");
    }
  }

  // ---- Numbers for the header -----------------------------------------
  const stats = useMemo(() => {
    const ready = materials.filter((m) => m.status === "ready");
    return {
      files: materials.length,
      pages: ready.reduce((n, m) => n + (m.page_count ?? 0), 0),
      passages: ready.reduce((n, m) => n + m.chunk_count, 0),
    };
  }, [materials]);

  // ---- Render ------------------------------------------------------------
  if (load.state === "loading") return <PageSkeleton />;

  if (load.state === "missing") {
    return (
      <Centered>
        <Mascot mood="confused" className="w-24" />
        <h1 className="mt-5 text-2xl font-extrabold">Course not found</h1>
        <p className="mt-1 text-muted-foreground">It may have been deleted, or the link is wrong.</p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/courses">
            <ArrowLeft aria-hidden="true" /> Back to your courses
          </Link>
        </Button>
      </Centered>
    );
  }

  if (load.state === "error") {
    return (
      <Centered>
        <Mascot mood="confused" className="w-24" />
        <h1 className="mt-5 text-2xl font-extrabold">Couldn&apos;t open this course</h1>
        <p className="mt-1 text-muted-foreground">{load.message}</p>
        <Button
          variant="outline"
          className="mt-5"
          onClick={() => {
            setLoad({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCw aria-hidden="true" /> Try again
        </Button>
      </Centered>
    );
  }

  const empty = materials.length === 0 && uploads.length === 0;

  return (
    // grid-cols-1 = one column of minmax(0, 1fr): it may shrink below its
    // content's width, so a long line can't stretch the page wider than a phone.
    <div className="grid grid-cols-1 gap-8">
      <header className="grid gap-4">
        <Link
          href="/courses"
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Courses
        </Link>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          {course?.code && (
            <span className="rounded-sm border border-primary/30 bg-primary/8 px-2 py-0.5 font-mono text-xs font-bold tracking-wider text-primary uppercase">
              {course.code}
            </span>
          )}
          <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.03em] break-words sm:text-5xl">{course?.name}</h1>
          {course?.description && (
            <p className="mt-2 max-w-2xl font-serif text-lg text-muted-foreground">{course.description}</p>
          )}
          {!empty && (
            <p className="mt-3 text-sm font-semibold text-muted-foreground">
              {stats.files} {stats.files === 1 ? "file" : "files"} · {stats.pages} pages read · {stats.passages}{" "}
              searchable passages
            </p>
          )}
        </motion.div>
      </header>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {empty ? (
        <section className="grid items-center gap-6 rounded-lg border bg-card p-6 sm:p-8 md:grid-cols-[1fr_auto]">
          <div className="grid gap-5">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight">Add your first notes</h2>
              <p className="mt-1 text-muted-foreground">
                StudyMate reads every page, keeps tables whole, and remembers which page each passage came from.
              </p>
            </div>
            <UploadDropzone onFiles={startUploads} mode={mode} onModeChange={changeMode} />
          </div>
          <Mascot mood="happy" className="mx-auto hidden w-32 md:block" />
        </section>
      ) : (
        <UploadDropzone onFiles={startUploads} mode={mode} onModeChange={changeMode} compact />
      )}

      {notice && (
        <p role="alert" className="-mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm font-medium">
          {notice}
        </p>
      )}

      {!empty && (
        <section aria-labelledby="files-heading" className="grid grid-cols-1 gap-3">
          <h2 id="files-heading" className="text-xl font-bold">
            Files
          </h2>
          <ul className="grid grid-cols-1 gap-3">
            <AnimatePresence initial={false}>
              {uploads.map((u) => (
                <UploadRow
                  key={u.key}
                  item={u}
                  onDismiss={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                />
              ))}
              {materials.map((m) => (
                <MaterialRow
                  key={m.id}
                  material={m}
                  reader={reader}
                  onView={setViewing}
                  onRename={setRenaming}
                  onRetry={onRetry}
                  onRetryPages={onRetryPages}
                  onDelete={setDeleting}
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      <PagesDialog material={viewing} onClose={() => setViewing(null)} />
      <RenameMaterialDialog
        material={renaming}
        onClose={() => setRenaming(null)}
        onSaved={(saved) => {
          setMaterials((list) => list.map((m) => (m.id === saved.id ? saved : m)));
          setRenaming(null);
        }}
      />
      <DeleteMaterialDialog
        material={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(gone) => {
          setMaterials((list) => list.filter((m) => m.id !== gone));
          setDeleting(null);
        }}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">{children}</div>;
}

function PageSkeleton() {
  return (
    <div className="grid animate-pulse gap-6" aria-busy="true" aria-label="Loading course">
      <div className="h-4 w-20 rounded bg-muted" />
      <div className="h-12 w-2/3 rounded bg-muted" />
      <div className="h-28 rounded-lg bg-muted" />
      <div className="h-20 rounded-lg bg-muted" />
    </div>
  );
}
