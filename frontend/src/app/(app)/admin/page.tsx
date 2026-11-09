"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Ban,
  Check,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessagesSquare,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  cleanupEmptyChats,
  compact,
  duration,
  getChatStats,
  getOverview,
  listAdminUsers,
  percent,
  setUserActive,
  type AdminChatDay,
  type AdminChatStats,
  type AdminOverview,
  type AdminUser,
} from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/courses";
import { cn } from "@/lib/utils";

/*
  Admin dashboard (Stage 8). How StudyMate is USED, never WHAT students study.

    numbers     users, files read, questions, pages read from pictures
    chat usage  questions per day (7 / 30 / 90 days) + answer outcomes + tokens
    models      each Gemini model: pages read for the picture reader + answers
    processing  files by status, picture pages, passages, processing time
    users       one row per account, with activate / deactivate for students
    upkeep      remove empty chats

  Everything comes from four admin-only requests (backend/app/routers/admin.py),
  which read four SQL views (migration 007) as a read-only database role.
  The role check here only decides what to SHOW; a student who opens /admin
  anyway gets 403 from every request. The backend is the security boundary.
*/

const EASE = [0.22, 1, 0.36, 1] as const;
const n = (x: number) => x.toLocaleString();
const USERS_SHOWN = 20;
const RANGES = [7, 30, 90] as const;

export default function AdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [stats, setStats] = useState<AdminChatStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    getOverview()
      .then(setOverview)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadOverview();
    listAdminUsers()
      .then(setUsers)
      .catch((e: ApiError) => setError(e.message));
  }, [isAdmin, loadOverview]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    getChatStats(days)
      .then((s) => alive && setStats(s))
      .catch((e: ApiError) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [isAdmin, days]);

  if (!isAdmin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
        <Mascot mood="confused" className="w-14" />
        <h1 className="mt-4 heading-5">Admins only</h1>
        <p className="mt-2 body-3 text-muted-foreground">This page shows how StudyMate is used. Your account is a student account.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      <motion.header initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <h1 className="heading-5 sm:heading-4">Admin</h1>
        <p className="mt-2 flex max-w-2xl items-start gap-2 body-3 text-muted-foreground">
          <ShieldCheck className="mt-1 size-4 shrink-0" aria-hidden="true" />
          How StudyMate is used. Students&apos; notes, questions and answers are never shown here: only counts,
          statuses and dates.
        </p>
      </motion.header>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border px-4 py-3 body-5 text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}

      {/* ---------- numbers ---------- */}
      <section
        aria-label="Totals"
        className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card lg:grid-cols-4 [&>*]:border-border max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r"
      >
        <Stat icon={Users} label="Users" value={overview?.users_total} note={overview && `${n(overview.students)} students · ${n(overview.admins)} admins`} />
        <Stat icon={FileText} label="Files read" value={overview?.files_ready} note={overview && `of ${n(overview.files_total)} uploaded`} />
        <Stat icon={MessagesSquare} label="Questions asked" value={overview?.questions_total} note={overview && `in ${n(overview.chats_total - overview.chats_empty)} chats`} />
        <Stat icon={ImageIcon} label="Picture pages read" value={overview?.pages_read_from_pictures} note={overview && `of ${n(overview.pages_total)} pages`} />
      </section>

      {/* ---------- chat usage ---------- */}
      <section aria-labelledby="chat-usage" className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
          <h2 id="chat-usage" className="title-3">
            Questions per day
          </h2>
          <RangePicker value={days} onChange={setDays} />
        </div>
        <div className="p-4">
          {stats ? <ChatUsage days={stats.days} /> : <div className="skeleton h-56 rounded-lg" />}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* ---------- models ---------- */}
        <section aria-labelledby="models" className="rounded-xl border bg-card">
          <h2 id="models" className="border-b px-4 py-3 title-3">
            Gemini models
          </h2>
          {!stats ? (
            <div className="p-4">
              <div className="skeleton h-24 rounded-lg" />
            </div>
          ) : stats.models.length === 0 ? (
            <p className="px-4 py-6 body-6 text-muted-foreground">No pages or answers from a model yet.</p>
          ) : (
            <ul className="divide-y">
              {stats.models.map((m) => (
                <li key={m.model} className="grid gap-1 px-4 py-3">
                  <p className="title-4">{m.model}</p>
                  <p className="caption-2 text-muted-foreground tabular-nums">
                    {m.answers.toLocaleString()} answers ({percent(m.not_in_notes, m.answers)} not in notes) ·{" "}
                    {m.pages_read.toLocaleString()} pages read
                  </p>
                  <p className="caption-2 text-muted-foreground tabular-nums">
                    {compact(m.prompt_tokens)} tokens in · {compact(m.output_tokens)} out
                    {m.avg_output_tokens !== null && ` · ${Math.round(m.avg_output_tokens)} per answer`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t px-4 py-3 caption-5 text-muted-foreground">
            The picture reader and the chat share one daily limit per model.
          </p>
        </section>

        {/* ---------- processing ---------- */}
        <section aria-labelledby="processing" className="rounded-xl border bg-card">
          <h2 id="processing" className="border-b px-4 py-3 title-3">
            Processing
          </h2>
          {!overview ? (
            <div className="p-4">
              <div className="skeleton h-40 rounded-lg" />
            </div>
          ) : (
            <Processing o={overview} />
          )}
        </section>
      </div>

      {/* ---------- users ---------- */}
      <UsersPanel
        users={users}
        onChanged={(u) => {
          setUsers((all) => (all ?? []).map((x) => (x.id === u.id ? u : x)));
          loadOverview();
        }}
      />

      {/* ---------- upkeep ---------- */}
      <Upkeep overview={overview} onCleaned={loadOverview} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  note: string | null | undefined;
}) {
  return (
    <div className="p-4">
      <p className="flex items-center gap-2 caption-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </p>
      <p className="mt-1 heading-5 tabular-nums">
        {value === undefined ? <span className="skeleton inline-block h-8 w-12 rounded-md align-middle" /> : value.toLocaleString()}
      </p>
      <p className="mt-1 caption-5 text-muted-foreground">{note ?? " "}</p>
    </div>
  );
}

/* Segmented control: 7 / 30 / 90 days. Inner radius 6 = outer 8 − 2 gap. */
function RangePicker({ value, onChange }: { value: number; onChange: (d: (typeof RANGES)[number]) => void }) {
  return (
    <div role="group" aria-label="Time range" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {RANGES.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={cn(
            "h-7 rounded-md px-3 button-xsm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            value === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}

const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", opts);

/*
  Bar chart in plain HTML: one series (questions), so no legend; the panel
  title names it. Bars grow with transform (scaleY), never height, so only
  the GPU works when they animate. Hover or focus a bar for the numbers;
  "Show as table" gives the same data to keyboard and screen-reader users.
*/
function ChatUsage({ days }: { days: AdminChatDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => d.questions));
  const total = days.reduce(
    (t, d) => ({
      questions: t.questions + d.questions,
      answered: t.answered + d.answered,
      not_in_notes: t.not_in_notes + d.not_in_notes,
      stopped: t.stopped + d.stopped,
      prompt: t.prompt + d.prompt_tokens,
      output: t.output + d.output_tokens,
    }),
    { questions: 0, answered: 0, not_in_notes: 0, stopped: 0, prompt: 0, output: 0 },
  );
  const answers = total.answered + total.not_in_notes + total.stopped;
  const shown = hover !== null ? days[hover] : null;

  return (
    <div className="grid gap-4">
      {/* The numbers for the whole range, as text first */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Figure label="Questions" value={total.questions.toLocaleString()} />
        <Figure label="Answered" value={percent(total.answered, answers)} />
        <Figure label="Not in notes" value={percent(total.not_in_notes, answers)} />
        <Figure label="Stopped" value={percent(total.stopped, answers)} />
        <Figure label="Tokens in / out" value={`${compact(total.prompt)} / ${compact(total.output)}`} />
      </dl>

      {asTable ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full caption-2 tabular-nums">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                {["Day", "Questions", "Answered", "Not in notes", "Stopped", "Users"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 caption-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row" className="px-3 py-2 text-left caption-4">
                    {dayLabel(d.day, { weekday: "short", day: "numeric", month: "short" })}
                  </th>
                  <td className="px-3 py-2">{d.questions}</td>
                  <td className="px-3 py-2">{d.answered}</td>
                  <td className="px-3 py-2">{d.not_in_notes}</td>
                  <td className="px-3 py-2">{d.stopped}</td>
                  <td className="px-3 py-2">{d.active_users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {/* tooltip line: fixed height, so the chart never jumps */}
          <p className="h-5 caption-2 text-muted-foreground tabular-nums" aria-live="polite">
            {shown ? (
              <>
                <span className="text-foreground">{dayLabel(shown.day, { weekday: "short", day: "numeric", month: "short" })}</span>
                {" · "}
                {shown.questions} {shown.questions === 1 ? "question" : "questions"} · {shown.answered} answered ·{" "}
                {shown.not_in_notes} not in notes · {shown.stopped} stopped · {shown.active_users}{" "}
                {shown.active_users === 1 ? "student" : "students"}
              </>
            ) : (
              "Point at a day to see its numbers."
            )}
          </p>
          <div className="relative mt-2 h-44" onPointerLeave={() => setHover(null)}>
            {/* recessive guide at the top value; the baseline is the panel's own line */}
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed" aria-hidden="true" />
            <span className="pointer-events-none absolute right-0 -top-5 caption-5 text-muted-foreground tabular-nums">{max}</span>
            <div
              className={cn("flex h-full items-end border-b", days.length > 45 ? "gap-px" : "gap-0.5")}
              role="img"
              aria-label={`Questions per day for the last ${days.length} days: ${total.questions} in total, most on one day ${max}.`}
            >
              {days.map((d, i) => (
                <div
                  key={d.day}
                  className="flex h-full min-w-0 flex-1 items-end"
                  onPointerEnter={() => setHover(i)}
                  aria-hidden="true"
                >
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: d.questions / max }}
                    transition={{ duration: 0.5, delay: Math.min(i * 0.008, 0.3), ease: EASE }}
                    className={cn(
                      "h-full w-full origin-bottom rounded-t-[4px] transition-opacity",
                      d.questions === 0 ? "bg-transparent" : "bg-chart",
                      hover !== null && hover !== i && "opacity-40",
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex justify-between caption-5 text-muted-foreground" aria-hidden="true">
            <span>{dayLabel(days[0].day)}</span>
            <span>{dayLabel(days[Math.floor(days.length / 2)].day)}</span>
            <span>Today</span>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-4">
        <p className="caption-5 text-muted-foreground">Days are India time. Tokens: what the chat answers cost.</p>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="shrink-0 rounded-md caption-4 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {asTable ? "Show as chart" : "Show as table"}
        </button>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="caption-5 text-muted-foreground">{label}</dt>
      <dd className="title-2 tabular-nums">{value}</dd>
    </div>
  );
}

function Processing({ o }: { o: AdminOverview }) {
  const rows: [string, React.ReactNode][] = [
    [
      "Files",
      <>
        {n(o.files_ready)} ready · {n(o.files_processing + o.files_pending)} in progress ·{" "}
        <span className={cn(o.files_failed > 0 && "text-destructive")}>{n(o.files_failed)} failed</span>
      </>,
    ],
    ["Reading mode", `${n(o.files_smart)} Smart · ${n(o.files_thorough)} Thorough`],
    [
      "Picture pages",
      <>
        {n(o.pages_read_from_pictures)} read · {n(o.pages_picture_waiting)} waiting ·{" "}
        <span className={cn(o.pages_picture_failed > 0 && "text-destructive")}>{n(o.pages_picture_failed)} failed</span>{" "}
        <span className="text-muted-foreground">(of {n(o.pages_needing_pictures)})</span>
      </>,
    ],
    [
      "Passages",
      `${o.passages_total.toLocaleString()} (${percent(o.passages_embedded, o.passages_total)} searchable by meaning, ${o.passages_from_pictures.toLocaleString()} from pictures)`,
    ],
    [
      "Reading time",
      o.files_timed === 0 ? (
        <span className="text-muted-foreground">Shown for files uploaded from now on.</span>
      ) : (
        <>
          median {duration(o.median_processing_seconds)} · average {duration(o.avg_processing_seconds)} ·{" "}
          {duration(o.avg_seconds_per_page)} per page{" "}
          <span className="text-muted-foreground">
            ({o.files_timed} {o.files_timed === 1 ? "file" : "files"})
          </span>
        </>
      ),
    ],
  ];
  return (
    <>
      <dl className="divide-y border-b">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
            <dt className="caption-2 text-muted-foreground">{k}</dt>
            <dd className="body-6 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="px-4 py-3 caption-5 text-muted-foreground">
        Reading time = upload to searchable text. Pictures and meaning search are added afterwards.
      </p>
    </>
  );
}

function UsersPanel({ users, onChanged }: { users: AdminUser[] | null; onChanged: (u: AdminUser) => void }) {
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Filtering 60-600 rows in the browser is instant; a server-side search
  // would only be worth it with many thousands of accounts.
  const q = query.trim().toLowerCase();
  const matches = (users ?? []).filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));
  const visible = showAll || q ? matches : matches.slice(0, USERS_SHOWN);

  async function change(u: AdminUser, active: boolean) {
    setBusyId(u.id);
    setError(null);
    try {
      onChanged(await setUserActive(u.id, active));
      setTarget(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="users" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="users" className="title-3">
          Users {users && <span className="caption-2 text-muted-foreground">({n(users.length)})</span>}
        </h2>
        <label htmlFor="user-search" className="sr-only">
          Search users by name or email
        </label>
        <input
          id="user-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email"
          className="h-8 w-full rounded-lg border bg-card px-3 body-6 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 sm:w-64"
        />
      </div>
      {error && (
        <p role="alert" className="border-b px-4 py-2 caption-2 text-destructive">
          {error}
        </p>
      )}
      {!users ? (
        <div className="grid gap-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-6 body-6 text-muted-foreground">No account matches &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="divide-y">
          {visible.map((u) => (
            <li key={u.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] md:items-center md:gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 title-4">
                  <span className={cn("truncate", !u.is_active && "text-muted-foreground")}>{u.name}</span>
                  {u.role === "admin" && <span className="caption-5 text-muted-foreground">Admin</span>}
                </p>
                <p className="truncate caption-5 text-muted-foreground">{u.email}</p>
              </div>
              <p className="caption-2 text-muted-foreground tabular-nums">
                {u.course_count} {u.course_count === 1 ? "course" : "courses"} · {u.file_count}{" "}
                {u.file_count === 1 ? "file" : "files"} · {u.question_count}{" "}
                {u.question_count === 1 ? "question" : "questions"}
                <br />
                Joined {timeAgo(u.joined_at)} · {u.last_question_at ? `last asked ${timeAgo(u.last_question_at)}` : "hasn't asked yet"}
              </p>
              <div className="flex items-center justify-between gap-2 md:justify-end">
                {u.is_active ? (
                  <span className="flex items-center gap-1 caption-4 text-success">
                    <Check className="size-3.5" aria-hidden="true" /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 caption-4 text-destructive">
                    <Ban className="size-3.5" aria-hidden="true" /> Deactivated
                  </span>
                )}
                {u.role === "student" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === u.id}
                    onClick={() => (u.is_active ? setTarget(u) : void change(u, true))}
                    aria-label={`${u.is_active ? "Deactivate" : "Activate"} ${u.name}`}
                  >
                    {busyId === u.id && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {u.is_active ? "Deactivate" : "Activate"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {visible.length < matches.length && (
        <div className="border-t px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Show all {n(matches.length)} accounts
          </Button>
        </div>
      )}

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        busy={busyId !== null}
        title={`Deactivate ${target?.name ?? ""}?`}
        description={target?.email}
        className="max-w-md"
      >
        <p className="body-6 text-muted-foreground">
          They are logged out at once and can&apos;t log in. Nothing is deleted: activate the account again to give them
          back their courses, notes and chats.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setTarget(null)} disabled={busyId !== null} data-autofocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => target && void change(target, false)} disabled={busyId !== null}>
            {busyId !== null && <Loader2 className="animate-spin" aria-hidden="true" />} Deactivate
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function Upkeep({ overview, onCleaned }: { overview: AdminOverview | null; onCleaned: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      const { deleted } = await cleanupEmptyChats();
      setResult(
        deleted === 0
          ? "Nothing to remove: the empty chats are less than an hour old."
          : `Removed ${deleted} empty ${deleted === 1 ? "chat" : "chats"}.`,
      );
      onCleaned();
    } catch (e) {
      setResult((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="upkeep" className="rounded-xl border bg-card">
      <h2 id="upkeep" className="border-b px-4 py-3 title-3">
        Upkeep
      </h2>
      <div className="flex flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="title-4">
            Empty chats: <span className="tabular-nums">{overview ? n(overview.chats_empty) : "…"}</span>
          </p>
          <p className="caption-5 text-muted-foreground">
            Left behind when a chat&apos;s first question failed. Students never see them; they are also removed each
            time the server starts. Chats less than an hour old are kept, as they may still be answering.
          </p>
          {result && (
            <p className="mt-1 caption-2" role="status">
              {result}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy || overview?.chats_empty === 0}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          Remove empty chats
        </Button>
      </div>
    </section>
  );
}
