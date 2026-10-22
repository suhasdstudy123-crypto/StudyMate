"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { deleteCourse, type Course } from "@/lib/courses";

/*
  "Are you sure?" before DELETE /api/courses/{id}.
  Deleting a course is the one action here that can't be undone: the
  database's ON DELETE CASCADE also removes every PDF and chunk in it.
  So we say exactly what will be lost, using the counts from the view.
*/
type Props = {
  course: Course | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

export function DeleteCourseDialog({ course, onClose, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  async function onConfirm() {
    if (!course) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCourse(course.id);
      onDeleted(course.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already gone (deleted in another tab): the result is the same.
        onDeleted(course.id);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't delete the course. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const files = course?.material_count ?? 0;

  return (
    <Dialog
      open={course !== null}
      onClose={close}
      busy={busy}
      title={`Delete "${course?.name ?? ""}"?`}
      description={
        files > 0 ? (
          <>
            This also deletes{" "}
            <strong className="font-bold text-foreground">
              {files} {files === 1 ? "file" : "files"}
            </strong>{" "}
            and everything StudyMate learned from them. Past chats stay, without the course. This can&apos;t be undone.
          </>
        ) : (
          <>This course has no files yet. This can&apos;t be undone.</>
        )
      }
    >
      <div className="grid gap-5">
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={close} disabled={busy} data-autofocus>
            Keep it
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {busy ? "Deleting..." : "Delete course"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
