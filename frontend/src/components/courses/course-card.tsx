"use client";

import Link from "next/link";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { timeAgo, type Course } from "@/lib/courses";
import { cn } from "@/lib/utils";

/*
  One course as a plain card: code, name, description, and the file count
  at the bottom. The numbers come straight from the course_overview view
  (material_count, ready_material_count).

  ref: <AnimatePresence mode="popLayout"> in the page needs to reach the
  card's DOM element to animate it out when it's deleted. (In React 19 a
  component can receive `ref` as a normal prop.)
*/
type Props = {
  course: Course;
  index: number;
  isNew?: boolean;
  onEdit: (course: Course) => void;
  onDelete: (course: Course) => void;
  ref?: React.Ref<HTMLLIElement>;
};

export function CourseCard({ course, index, isNew = false, onEdit, onDelete, ref }: Props) {
  const files = course.material_count;
  const ready = course.ready_material_count;

  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.5, delay: isNew ? 0 : Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <article
        className={cn(
          "relative flex h-full min-h-44 overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] duration-300",
          "hover:border-foreground/25 hover:shadow-sm",
          isNew && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        aria-labelledby={`course-${course.id}`}
      >
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex min-h-8 items-start justify-between gap-3">
            {course.code ? (
              <span className="pt-1 caption-4 tabular-nums text-muted-foreground">{course.code}</span>
            ) : (
              <span />
            )}

            {/* Edit / delete. On a mouse they appear on hover; on touch they're
                always visible (there is no hover); keyboard focus shows them too. */}
            <div className="relative z-10 -mr-2 flex gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              <IconButton label={`Edit ${course.name}`} onClick={() => onEdit(course)}>
                <Pencil />
              </IconButton>
              <IconButton label={`Delete ${course.name}`} onClick={() => onDelete(course)} danger>
                <Trash2 />
              </IconButton>
            </div>
          </div>

          <h2
            id={`course-${course.id}`}
            className="mt-1 line-clamp-2 title-2 break-words"
          >
            {/* "Stretched link": the link's ::after covers the whole card, so a
                click anywhere opens the course. The edit/delete buttons sit
                above it (relative z-10), and a <button> inside a link would be
                invalid HTML, which is why it's done this way round. */}
            <Link
              href={`/courses/${course.id}`}
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {course.name}
            </Link>
          </h2>
          {course.description ? (
            <p className="mt-1 mb-4 line-clamp-2 body-6 text-muted-foreground">{course.description}</p>
          ) : (
            <p className="mt-1 mb-4 body-6 text-muted-foreground/70">No description</p>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 caption-2">
            <span className="inline-flex items-center gap-2 body-5">
              <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
              {files === 0 ? (
                <span className="text-muted-foreground">No files yet</span>
              ) : (
                <span>
                  {files} {files === 1 ? "file" : "files"}
                  {ready < files && <span className="text-muted-foreground"> · {ready} ready</span>}
                </span>
              )}
            </span>
            <span className="text-muted-foreground" title={new Date(course.last_activity).toLocaleString()}>
              {timeAgo(course.last_activity)}
            </span>
          </div>
        </div>
      </article>
    </motion.li>
  );
}

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center rounded-lg text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
        danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
