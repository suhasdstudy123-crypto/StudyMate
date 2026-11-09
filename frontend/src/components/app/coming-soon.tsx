import { Mascot } from "@/components/mascot";

/* Placeholder for pages built in later stages. */
export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <Mascot mood="confused" className="w-14" />
      <h1 className="mt-4 heading-5">{title}</h1>
      <p className="mt-2 body-3 text-muted-foreground">{body}</p>
    </div>
  );
}
