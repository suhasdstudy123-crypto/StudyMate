import { FileText } from "lucide-react";

/*
  Two endless rows of file names sliding in opposite directions.
  Pure CSS animation (see .marquee in globals.css): each row's list is
  rendered twice and slides left by exactly half its width, so the loop
  is seamless. Hovering pauses it. No JavaScript needed, so this stays
  a Server Component.
*/

const ROW_ONE = [
  "DBMS Unit 4 Transactions.pdf",
  "OS PYQ 2024.pdf",
  "Computer Networks Lab Manual.pdf",
  "Maths III Formula Sheet.pdf",
  "DAA Unit 2 Greedy Algorithms.pdf",
  "Machine Learning Lecture 7.pdf",
];

const ROW_TWO = [
  "Compiler Design PYQ 2023.pdf",
  "Microprocessors Unit 1.pdf",
  "DBMS Normalisation Notes.pdf",
  "OS Unit 3 Memory Management.pdf",
  "Software Engineering Slides.pdf",
  "CN Unit 2 Network Layer.pdf",
];

function Row({ files, reverse, duration }: { files: string[]; reverse?: boolean; duration: string }) {
  return (
    <div className="marquee-track flex overflow-hidden">
      <ul
        className={`marquee flex shrink-0 gap-3 pr-3 ${reverse ? "marquee-reverse" : ""}`}
        style={{ "--marquee-duration": duration } as React.CSSProperties}
      >
        {[...files, ...files].map((file, i) => (
          <li
            key={i}
            aria-hidden={i >= files.length} // the copy is decoration only
            className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium"
          >
            <FileText className="size-4 text-primary" aria-hidden="true" />
            {file}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FileMarquee() {
  return (
    <section className="border-y bg-card/50 py-14" aria-labelledby="files-heading">
      <h2 id="files-heading" className="mx-auto max-w-6xl px-5 text-center text-2xl font-extrabold tracking-tight sm:px-8 sm:text-3xl">
        Everything you study from, in one place.
      </h2>
      <div
        className="mt-9 flex flex-col gap-3"
        // Fade the rows out at both edges
        style={{ maskImage: "linear-gradient(to right, transparent, black 12%, black 88%, transparent)" }}
      >
        <Row files={ROW_ONE} duration="45s" />
        <Row files={ROW_TWO} duration="52s" reverse />
      </div>
    </section>
  );
}
