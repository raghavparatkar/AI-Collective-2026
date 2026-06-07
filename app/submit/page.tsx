import { PERSONAS } from "@/lib/evaluators/personas";
import SubmitForm from "./submit-form";

export default function SubmitPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Submit an agent
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Provide two documents representing your agent. Both will be evaluated
          in parallel by a {PERSONAS.length}-persona panel.
        </p>
      </header>
      <SubmitForm personaKeys={PERSONAS.map((p) => p.key)} />
    </div>
  );
}
