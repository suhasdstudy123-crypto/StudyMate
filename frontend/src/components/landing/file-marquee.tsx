import { FileText } from "lucide-react";

/*
  The kinds of files students bring, as a plain, still list.
  (It used to be two endlessly sliding rows; a still list is calmer, easier
  to read, and needs no animation.) No JavaScript, so this stays a
  Server Component.
*/

const FILES = [
  "DBMS Unit 4 Transactions.pdf",
  "OS PYQ 2024.pdf",
  "Computer Networks Lab Manual.pdf",
  "Maths III Formula Sheet.pdf",
  "DAA Unit 2 Greedy Algorithms.pdf",
  "Machine Learning Lecture 7.pdf",
  "Compiler Design PYQ 2023.pdf",
  "Microprocessors Unit 1.pdf",
  "OS Unit 3 Memory Management.pdf",
];

export function FileMarquee() {
  return (
    <section className="border-y bg-card" aria-labelledby="files-heading">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 sm:px-8 lg:grid-cols-[1fr_2fr] lg:gap-16">
        <div>
          <h2 id="files-heading" className="heading-5 sm:heading-4">
            Everything you study from, in one place.
          </h2>
        </div>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {FILES.map((file) => (
            <li key={file} className="flex items-center gap-2 border-b py-3 body-6">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">{file}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
