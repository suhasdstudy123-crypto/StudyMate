"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { COURSE_LIMITS, createCourse, updateCourse, type Course, type CourseInput } from "@/lib/courses";

/*
  ONE form for both "New course" and "Edit course":
    course = undefined -> create mode -> POST  /api/courses
    course = a Course  -> edit mode   -> PATCH /api/courses/{id}
  The fields, validation and error handling are identical, so sharing
  the component means a rule can never differ between the two.
*/
type Props = {
  open: boolean;
  onClose: () => void;
  course?: Course;
  /** Pre-filled name, e.g. from a "DBMS" suggestion chip */
  suggestedName?: string;
  onSaved: (course: Course) => void;
};

type Errors = Partial<Record<keyof CourseInput | "form", string>>;

export function CourseFormDialog({ open, onClose, course, suggestedName, onSaved }: Props) {
  const editing = Boolean(course);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={editing ? "Edit course" : "New course"}
      description={
        editing
          ? "Rename it or update the details. Your notes stay where they are."
          : "One course per subject keeps each subject's notes together, so answers only come from the right notes."
      }
    >
      {/* key: a fresh form (fresh state) every time a different course opens */}
      <CourseForm
        key={course?.id ?? `new-${suggestedName ?? ""}`}
        course={course}
        suggestedName={suggestedName}
        busy={busy}
        setBusy={setBusy}
        onCancel={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  );
}

function CourseForm({
  course,
  suggestedName,
  busy,
  setBusy,
  onCancel,
  onSaved,
}: {
  course?: Course;
  suggestedName?: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (course: Course) => void;
}) {
  const [values, setValues] = useState<CourseInput>({
    name: course?.name ?? suggestedName ?? "",
    code: course?.code ?? "",
    description: course?.description ?? "",
  });
  const [errors, setErrors] = useState<Errors>({});

  function set(field: keyof CourseInput, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    // Typing in a field clears its error, so the message never goes stale.
    if (errors[field] || errors.form) setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  // The same rules as CourseCreate in schemas.py, checked here first for
  // instant feedback. The backend checks them again: never trust the browser.
  function validate(): Errors {
    const e: Errors = {};
    if (!values.name.trim()) e.name = "Give your course a name.";
    else if (values.name.trim().length > COURSE_LIMITS.name) e.name = `Keep it under ${COURSE_LIMITS.name} characters.`;
    if (values.code.trim().length > COURSE_LIMITS.code) e.code = `Keep it under ${COURSE_LIMITS.code} characters.`;
    if (values.description.trim().length > COURSE_LIMITS.description)
      e.description = `Keep it under ${COURSE_LIMITS.description} characters.`;
    return e;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate();
    if (Object.keys(found).length) return setErrors(found);

    setBusy(true);
    try {
      const saved = course ? await updateCourse(course.id, values) : await createCourse(values);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // UNIQUE index (user_id, lower(name)) said no
        setErrors({ name: "You already have a course with this name." });
      } else if (err instanceof ApiError && err.status === 422) {
        setErrors({ ...err.fieldErrors, form: err.message });
      } else if (err instanceof ApiError && err.status === 404) {
        setErrors({ form: "This course doesn't exist any more. Close this and refresh the page." });
      } else {
        setErrors({ form: err instanceof ApiError ? err.message : "Something went wrong. Please try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  const descLeft = COURSE_LIMITS.description - values.description.length;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {errors.form && <FormAlert>{errors.form}</FormAlert>}

      <FormField
        id="course-name"
        label="Course name"
        placeholder="Database Management Systems"
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        error={errors.name}
        maxLength={COURSE_LIMITS.name}
        autoComplete="off"
        data-autofocus
        disabled={busy}
      />

      <FormField
        id="course-code"
        label="Course code (optional)"
        placeholder="UE24CS301"
        value={values.code}
        onChange={(e) => set("code", e.target.value)}
        error={errors.code}
        maxLength={COURSE_LIMITS.code}
        autoComplete="off"
        disabled={busy}
      />

      <div className="grid gap-2">
        <Label htmlFor="course-description">Description (optional)</Label>
        <Textarea
          id="course-description"
          placeholder="Semester 5. Units 1-5, plus previous-year papers."
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby="course-description-msg"
          maxLength={COURSE_LIMITS.description}
          rows={3}
          disabled={busy}
        />
        <p
          id="course-description-msg"
          className={errors.description ? "text-sm font-medium text-destructive" : "text-xs text-muted-foreground"}
        >
          {errors.description ?? (descLeft < 200 ? `${descLeft} characters left` : "A short note for yourself.")}
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {course ? (busy ? "Saving..." : "Save changes") : busy ? "Creating..." : "Create course"}
        </Button>
      </div>
    </form>
  );
}
