"use client";

import Link from "next/link";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { timeAgo, type Course } from "@/lib/courses";
import { cn } from "@/lib/utils";

/*
  One course, drawn as a notebook: a ballpoint-blue spine with binding
  holes on the left, faint ruled lines on the page, the course code as a
  label in the corner. The numbers at the bottom come straight from the
  course_overview view (material_count, ready_material_count).

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
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ duration: 0.35, delay: isNew ? 0 : Math.min(index, 8) * 0.05, ease: "easeOut" }}
      className="group relative"
    >
      <article
        className={cn(
          "relative flex h-full min-h-52 overflow-hidden rounded-lg border bg-card shadow-[0_1px_0_var(--rule)] transition-[transform,box-shadow] duration-200",
          "hover:-translate-y-1 hover:shadow-[0_14px_30px_-14px_color-mix(in_oklab,var(--ink)_35%,transparent)]",
          "focus-within:-translate-y-1",
          isNew && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        aria-labelledby={`course-${course.id}`}
      >
        {/* the spine */}
        <div aria-hidden="true" className="binding w-7 shrink-0 bg-primary" />

        <div className="ruled flex min-w-0 flex-1 flex-col p-5 pl-5">
          <div className="flex items-start justify-between gap-3">
            {course.code ? (
              <span className="rounded-sm border border-primary/30 bg-primary/8 px-2 py-0.5 font-mono text-[0.7rem] font-bold tracking-wider text-primary uppercase">
                {course.code}
              </span>
            ) : (
              <span />
            )}

            {/* Edit / delete. On a mouse they appear on hover; on touch they're
                always visible (there is no hover); keyboard focus shows them too. */}
            <div className="relative z-10 -mt-1 -mr-2 flex gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
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
            className="mt-3 line-clamp-2 text-xl leading-7 font-extrabold tracking-tight break-words"
          >
            {/* "Stretched link": the link's ::after covers the whole card, so a
                click anywhere opens the course. The edit/delete buttons sit
                above it (relative z-10), and a <button> inside a link would be
                invalid HTML, which is why it's done this way round. */}
            <Link
              href={`/courses/${course.id}`}
              className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
            >
              {course.name}
            </Link>
          </h2>
          {course.description ? (
            <p className="mt-1 line-clamp-2 font-serif text-[0.95rem] leading-7 text-muted-foreground">
              {course.description}
            </p>
          ) : (
            <p className="mt-1 text-sm leading-7 text-muted-foreground/70 italic">No description</p>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-5 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <FileText className="size-4 text-primary" aria-hidden="true" />
              {files === 0 ? (
                <span className="text-muted-foreground">No files yet</span>
              ) : (
                <span>
                  {files} {files === 1 ? "file" : "files"}
                  {ready < files && <span className="font-normal text-muted-foreground"> · {ready} ready</span>}
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
        "grid size-9 place-items-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
        danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
