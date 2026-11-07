"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Table2,
  Trash2,
  Workflow,
} from "lucide-react";

import { Mascot } from "@/components/mascot";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage,
  type ChatMessage,
  type ChatSession,
  type SourceCitation,
} from "@/lib/chat";
import { listCourses, timeAgo, type Course } from "@/lib/courses";
import { fileUrl } from "@/lib/materials";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Load courses and initial sessions
  useEffect(() => {
    let alive = true;
    Promise.all([listCourses(), listChatSessions()])
      .then(([crs, sess]) => {
        if (!alive) return;
        setCourses(crs);
        setSessions(sess);
        if (sess.length > 0) {
          setActiveSessionId(sess[0].id);
        }
        setLoadingSessions(false);
      })
      .catch((err) => {
        if (!alive) return;
        setErrorNotice(err instanceof ApiError ? err.message : "Couldn't load chat history.");
        setLoadingSessions(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load messages whenever active session changes
  useEffect(() => {
    let alive = true;
    if (!activeSessionId) {
      return;
    }
    getChatSession(activeSessionId)
      .then((detail) => {
        if (!alive) return;
        setMessages(detail.messages);
        setSelectedCourseId(detail.course_id ?? null);
        setLoadingMessages(false);
      })
      .catch((err) => {
        if (!alive) return;
        setErrorNotice(err instanceof ApiError ? err.message : "Couldn't load conversation messages.");
        setLoadingMessages(false);
      });
    return () => {
      alive = false;
    };
  }, [activeSessionId]);

  async function handleNewChat(courseId: string | null = null) {
    try {
      setErrorNotice(null);
      const created = await createChatSession({
        course_id: courseId,
        title: "New Chat",
      });
      setSessions((prev) => [created, ...prev]);
      setActiveSessionId(created.id);
      setSelectedCourseId(courseId);
      setMessages([]);
      setShowMobileSidebar(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      setErrorNotice(err instanceof ApiError ? err.message : "Couldn't create chat session.");
    }
  }

  async function handleDeleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await deleteChatSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id);
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      setErrorNotice(err instanceof ApiError ? err.message : "Couldn't delete conversation.");
    }
  }

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const q = input.trim();
    if (!q || sending) return;

    let sessionId = activeSessionId;

    setSending(true);
    setInput("");
    setErrorNotice(null);

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: q,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      // If no active session, create one first
      if (!sessionId) {
        const created = await createChatSession({
          course_id: selectedCourseId,
          title: q.slice(0, 45),
        });
        sessionId = created.id;
        setActiveSessionId(created.id);
        setSessions((prev) => [created, ...prev]);
      }

      const assistantMsg = await sendChatMessage(sessionId, q);
      setMessages((prev) => [...prev, assistantMsg]);

      // Update session title in list if this was the first question
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId && (!s.title || s.title === "New Chat")
            ? { ...s, title: q.slice(0, 45) + (q.length > 45 ? "..." : "") }
            : s
        )
      );
    } catch (err) {
      setErrorNotice(err instanceof ApiError ? err.message : "Failed to generate answer. Please try again.");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const activeCourse = courses.find((c) => c.id === selectedCourseId);

  return (
    <div className="grid h-[calc(100vh-8rem)] grid-cols-1 md:grid-cols-[280px_1fr] gap-4 rounded-xl border bg-card overflow-hidden shadow-sm">
      {/* Mobile Sidebar Toggle */}
      <div className="flex md:hidden items-center justify-between border-b px-4 py-2.5 bg-muted/40">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          className="text-xs font-semibold"
        >
          <MessageSquare className="size-3.5 mr-1.5" />
          {sessions.find((s) => s.id === activeSessionId)?.title || "Conversations"}
        </Button>
        <Button variant="default" size="sm" onClick={() => handleNewChat(selectedCourseId)} className="text-xs">
          <Plus className="size-3.5 mr-1" /> New
        </Button>
      </div>

      {/* Conversations Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r bg-muted/20 z-20 transition-transform duration-200",
          "md:relative md:translate-x-0 md:flex",
          showMobileSidebar
            ? "absolute inset-y-0 left-0 w-3/4 max-w-xs bg-background shadow-lg translate-x-0 flex"
            : "hidden md:flex"
        )}
      >
        <div className="p-3 border-b flex items-center justify-between gap-2">
          <Button
            onClick={() => handleNewChat(selectedCourseId)}
            className="w-full justify-start gap-2 text-sm font-semibold shadow-none"
            variant="default"
          >
            <Plus className="size-4" /> New Chat
          </Button>
        </div>

        {/* Scope selector */}
        <div className="px-3 py-2 border-b">
          <label htmlFor="course-select" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
            Study Material Scope
          </label>
          <select
            id="course-select"
            value={selectedCourseId ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setSelectedCourseId(val);
              handleNewChat(val);
            }}
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Courses & Notes</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `[${c.code}] ` : ""}
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingSessions ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground text-xs">
              <Loader2 className="size-4 animate-spin mr-2" /> Loading chats...
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No previous chats. Ask a question to begin!
            </div>
          ) : (
            sessions.map((sess) => {
              const active = sess.id === activeSessionId;
              return (
                <div
                  key={sess.id}
                  onClick={() => {
                    if (sess.id !== activeSessionId) {
                      setLoadingMessages(true);
                      setErrorNotice(null);
                      setActiveSessionId(sess.id);
                    }
                    setShowMobileSidebar(false);
                  }}
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium cursor-pointer transition-colors",
                    active
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-6">
                    <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{sess.title || "New Chat"}</span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] shrink-0 opacity-60 absolute right-8 group-hover:hidden",
                      active ? "text-primary-foreground" : "text-muted-foreground"
                    )}
                  >
                    {timeAgo(sess.updated_at)}
                  </span>
                  <button
                    onClick={(e) => handleDeleteSession(sess.id, e)}
                    className={cn(
                      "opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0",
                      active ? "text-primary-foreground" : "text-muted-foreground hover:text-destructive"
                    )}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Workspace */}
      <main className="flex flex-col h-full overflow-hidden bg-background">
        {/* Header */}
        <div className="border-b px-6 py-3 flex items-center justify-between bg-muted/10">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-extrabold tracking-tight truncate max-w-md">
              {sessions.find((s) => s.id === activeSessionId)?.title || "StudyMate Assistant"}
            </h1>
            {activeCourse ? (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                {activeCourse.code ?? activeCourse.name}
              </span>
            ) : (
              <span className="rounded-full border border-muted bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                All notes
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground hidden sm:block">
            Grounding: strictly from your uploaded PDFs
          </div>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loadingMessages ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
              <Loader2 className="size-6 animate-spin text-primary" />
              <span>Retrieving conversation notes...</span>
            </div>
          ) : messages.length === 0 ? (
            <EmptyChatHero
              courseName={activeCourse?.name}
              onPromptClick={(promptText) => {
                setInput(promptText);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            />
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          )}

          {sending && (
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="size-4 text-primary animate-pulse" />
              </div>
              <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3 shadow-xs text-sm">
                <div className="flex items-center gap-2 text-muted-foreground font-medium">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Searching notes & synthesizing grounded answer...</span>
                </div>
              </div>
            </div>
          )}

          {errorNotice && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive font-medium">
              {errorNotice}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t bg-card/60">
          <form onSubmit={handleSend} className="relative flex items-end gap-2 max-w-4xl mx-auto">
            <div className="relative flex-1">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeCourse
                    ? `Ask about ${activeCourse.name}... (Enter to send, Shift+Enter for newline)`
                    : "Ask questions from your uploaded study materials..."
                }
                rows={1}
                className="min-h-[48px] max-h-36 pr-12 py-3 resize-none rounded-xl bg-background text-sm shadow-xs focus-visible:ring-primary"
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || sending}
              className="size-11 shrink-0 rounded-xl"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
              <span className="sr-only">Send question</span>
            </Button>
          </form>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            StudyMate only answers from your uploaded study notes and cites exact document pages.
          </p>
        </div>
      </main>
    </div>
  );
}

function EmptyChatHero({
  courseName,
  onPromptClick,
}: {
  courseName?: string;
  onPromptClick: (prompt: string) => void;
}) {
  const suggestions = courseName
    ? [
        `Explain the core concepts covered in ${courseName}.`,
        "What are the main definitions and examples in these notes?",
        "Summarize the key formulas or diagrams found in this material.",
      ]
    : [
        "What is Third Normal Form (3NF) and why is it important?",
        "Explain ACID properties in database transaction management.",
        "Compare B-Trees and B+ Trees with their search complexities.",
      ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[360px] text-center px-4 py-8">
      <Mascot mood="happy" className="w-20 mb-4" />
      <h2 className="text-2xl font-extrabold tracking-tight">Ask your study material</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground font-serif">
        {courseName
          ? `Ask any question grounded strictly in your uploaded ${courseName} notes, slides, and PYQs.`
          : "StudyMate searches across all your uploaded lecture notes and returns answers with exact page citations."}
      </p>

      <div className="mt-8 grid gap-2 w-full max-w-md">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground text-left px-1">
          Suggested Questions
        </span>
        {suggestions.map((sug, i) => (
          <button
            key={i}
            onClick={() => onPromptClick(sug)}
            className="flex items-center justify-between text-left rounded-lg border bg-card px-3.5 py-2.5 text-xs font-medium hover:border-primary/50 hover:bg-primary/5 transition-all"
          >
            <span>{sug}</span>
            <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAnswer = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCitationClick = (rank: number) => {
    setSourcesOpen(true);
    setTimeout(() => {
      const el = document.getElementById(`source-card-${message.id}-${rank}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.classList.add("ring-2", "ring-primary");
        setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
      }
    }, 80);
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-xs bg-primary px-4 py-3 text-sm text-primary-foreground leading-relaxed shadow-xs">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {timeAgo(message.created_at)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 w-full">
      <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5 select-none">
        <Sparkles className="size-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col items-start">
        <div className="w-full max-w-[94%] sm:max-w-[88%] rounded-2xl rounded-tl-xs border bg-card/90 px-4 sm:px-5 py-3.5 sm:py-4 text-sm leading-relaxed shadow-xs">
          {/* Formatted Markdown Content */}
          <MarkdownRenderer
            content={message.content}
            sources={message.sources}
            onCitationClick={handleCitationClick}
          />

          {/* Action footer & Source citations */}
          <div className="mt-4 pt-2.5 border-t border-border/60 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              {message.sources && message.sources.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSourcesOpen(!sourcesOpen)}
                  className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline outline-none cursor-pointer"
                >
                  <BookOpen className="size-3.5" />
                  <span>
                    {message.sources.length} {message.sources.length === 1 ? "Source citation" : "Source citations"}
                  </span>
                  <ChevronDown
                    className={cn("size-3.5 transition-transform duration-150", sourcesOpen && "rotate-180")}
                  />
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground italic">No document passages cited</span>
              )}

              <button
                type="button"
                onClick={handleCopyAnswer}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors ml-auto cursor-pointer"
                title="Copy response text"
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-emerald-500" />
                    <span className="text-emerald-500 font-semibold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy answer</span>
                  </>
                )}
              </button>
            </div>

            {/* Collapsible Source Citation Cards */}
            {sourcesOpen && message.sources && message.sources.length > 0 && (
              <div className="mt-1 space-y-2.5 pt-1">
                {message.sources.map((src) => (
                  <SourceCard key={src.chunk_id} messageId={message.id} source={src} />
                ))}
              </div>
            )}
          </div>
        </div>

        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {timeAgo(message.created_at)}
        </span>
      </div>
    </div>
  );
}

function SourceCard({ messageId, source }: { messageId: string; source: SourceCitation }) {
  const [expanded, setExpanded] = useState(false);

  const typeIcon =
    source.chunk_type === "table" ? (
      <Table2 className="size-3.5 text-amber-500" />
    ) : source.chunk_type === "diagram" ? (
      <Workflow className="size-3.5 text-blue-500" />
    ) : (
      <FileText className="size-3.5 text-muted-foreground" />
    );

  return (
    <div
      id={`source-card-${messageId}-${source.rank}`}
      className="rounded-lg border bg-background/90 p-3 text-xs shadow-2xs transition-all duration-200"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground truncate">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary shrink-0">
            Source {source.rank}
          </span>
          {typeIcon}
          <span className="truncate">{source.material_title}</span>
          <span className="text-muted-foreground font-normal shrink-0">· Page {source.page_number}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {source.similarity !== null && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary">
              {Math.round(source.similarity * 100)}% match
            </span>
          )}
          <a
            href={fileUrl(source.material_id)}
            target="_blank"
            rel="noreferrer"
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            title="Open original PDF in new tab"
          >
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      {/* Quoted Excerpt */}
      <div className="mt-2 font-serif text-muted-foreground text-[11px] leading-relaxed border-l-2 border-primary/40 pl-2.5 bg-primary/5 py-1.5 rounded-r">
        {expanded ? source.content : source.content.slice(0, 160) + (source.content.length > 160 ? "..." : "")}
      </div>

      {source.content.length > 160 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {expanded ? "Show less" : "Show full passage"}
        </button>
      )}
    </div>
  );
}
