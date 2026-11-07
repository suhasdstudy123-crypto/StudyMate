"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, FolderPlus, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { DeleteMaterialDialog, RenameMaterialDialog } from "@/components/materials/material-dialogs";
import { MaterialRow } from "@/components/materials/material-row";
import { PagesDialog } from "@/components/materials/pages-dialog";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listCourses, type Course } from "@/lib/courses";
import {
  getVisionStatus,
  isReadingPictures,
  isWorking,
  listAllMaterials,
  retryFailedPages,
  retryMaterial,
  type Material,
  type ReaderStatus,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

const POLL_MS = 1500;
const PICTURE_POLL_MS = 5000;

export default function MaterialsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [viewing, setViewing] = useState<Material | null>(null);
  const [renaming, setRenaming] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);
  const [reader, setReader] = useState<ReaderStatus | null>(null);

  // Initial load
  useEffect(() => {
    let alive = true;
    Promise.all([listCourses(), listAllMaterials()])
      .then(([crs, mats]) => {
        if (!alive) return;
        setCourses(crs);
        setMaterials(mats);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setErrorNotice(err instanceof ApiError ? err.message : "Couldn't load study materials.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Polling for processing/vision
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
      listAllMaterials(selectedCourseId)
        .then((list) => {
          setMaterials((prev) => {
            // merge or replace
            if (!selectedCourseId) return list;
            const otherCourseMats = prev.filter((m) => m.course_id !== selectedCourseId);
            return [...otherCourseMats, ...list];
          });
        })
        .catch(() => {});
    };
    if (anyPictures) tick();
    const timer = setInterval(tick, anyWorking ? POLL_MS : PICTURE_POLL_MS);
    return () => clearInterval(timer);
  }, [anyWorking, anyPictures, selectedCourseId]);

  async function onRetry(m: Material) {
    try {
      const updated = await retryMaterial(m.id);
      setMaterials((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setErrorNotice(err instanceof ApiError ? err.message : "Couldn't retry processing.");
    }
  }

  async function onRetryPages(m: Material) {
    try {
      const updated = await retryFailedPages(m.id);
      setMaterials((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setErrorNotice(err instanceof ApiError ? err.message : "Couldn't retry vision reading.");
    }
  }

  // Filtered materials
  const displayedMaterials = useMemo(() => {
    if (!selectedCourseId) return materials;
    return materials.filter((m) => m.course_id === selectedCourseId);
  }, [materials, selectedCourseId]);

  // Overall stats
  const stats = useMemo(() => {
    const ready = materials.filter((m) => m.status === "ready");
    return {
      totalFiles: materials.length,
      totalPages: ready.reduce((acc, m) => acc + (m.page_count ?? 0), 0),
      totalPassages: ready.reduce((acc, m) => acc + m.chunk_count, 0),
    };
  }, [materials]);

  const coursesById = useMemo(() => {
    const map = new Map<string, Course>();
    courses.forEach((c) => map.set(c.id, c));
    return map;
  }, [courses]);

  if (loading) {
    return (
      <div className="grid gap-6 animate-pulse">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-12 w-full rounded-lg bg-muted" />
        <div className="space-y-3">
          <div className="h-20 rounded-lg bg-muted" />
          <div className="h-20 rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Study Materials</h1>
          <p className="mt-2 text-sm font-semibold text-muted-foreground font-serif">
            {stats.totalFiles} {stats.totalFiles === 1 ? "document" : "documents"} · {stats.totalPages} pages read ·{" "}
            {stats.totalPassages} searchable passages across all courses
          </p>
        </div>

        {courses.length > 0 && (
          <Button asChild variant="default" className="w-fit shadow-xs">
            <Link href={selectedCourseId ? `/courses/${selectedCourseId}` : `/courses`}>
              <Plus className="size-4 mr-1" />
              Upload to Course
            </Link>
          </Button>
        )}
      </header>

      {errorNotice && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
          {errorNotice}
        </div>
      )}

      {/* Course Filter Bar */}
      {courses.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCourseId(null)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
              selectedCourseId === null
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            All Courses ({materials.length})
          </button>
          {courses.map((c) => {
            const count = materials.filter((m) => m.course_id === c.id).length;
            const active = selectedCourseId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCourseId(c.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {c.code && <span className="opacity-75 font-mono text-[10px]">[{c.code}]</span>}
                <span>{c.name}</span>
                <span className="opacity-60 text-[10px]">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {courses.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center flex flex-col items-center">
          <Mascot mood="confused" className="w-24 mb-4" />
          <h2 className="text-xl font-bold">No courses created yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-md">
            Create your first course to begin uploading study materials and lecture notes.
          </p>
          <Button asChild className="mt-6">
            <Link href="/courses">
              <FolderPlus className="size-4 mr-1.5" /> Go to Courses
            </Link>
          </Button>
        </div>
      ) : displayedMaterials.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center flex flex-col items-center">
          <Mascot mood="happy" className="w-24 mb-4" />
          <h2 className="text-xl font-bold">
            {selectedCourseId ? "No files in this course yet" : "No study materials uploaded"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-md">
            Upload PDFs, slides, and PYQs inside your courses. StudyMate reads every page, keeps tables whole, and transcribes diagrams.
          </p>
          <Button asChild className="mt-6">
            <Link href={selectedCourseId ? `/courses/${selectedCourseId}` : `/courses`}>
              <Plus className="size-4 mr-1.5" />
              {selectedCourseId ? "Upload to this course" : "Select a Course to Upload"}
            </Link>
          </Button>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-3">
          <ul className="grid grid-cols-1 gap-3">
            <AnimatePresence initial={false}>
              {displayedMaterials.map((m) => {
                const course = coursesById.get(m.course_id);
                return (
                  <div key={m.id} className="relative group">
                    {course && !selectedCourseId && (
                      <div className="text-[11px] font-bold text-muted-foreground mb-1 flex items-center gap-1.5">
                        <Link
                          href={`/courses/${course.id}`}
                          className="hover:text-primary transition-colors inline-flex items-center gap-1"
                        >
                          <BookOpen className="size-3" />
                          <span>{course.name}</span>
                          {course.code && <span className="font-mono">({course.code})</span>}
                          <ArrowRight className="size-2.5 opacity-60" />
                        </Link>
                      </div>
                    )}
                    <MaterialRow
                      material={m}
                      reader={reader}
                      onView={setViewing}
                      onRename={setRenaming}
                      onRetry={onRetry}
                      onRetryPages={onRetryPages}
                      onDelete={setDeleting}
                    />
                  </div>
                );
              })}
            </AnimatePresence>
          </ul>
        </section>
      )}

      {/* Dialogs */}
      <PagesDialog
        material={viewing}
        onClose={() => setViewing(null)}
        onChanged={(updated) => setMaterials((list) => list.map((m) => (m.id === updated.id ? updated : m)))}
      />
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
