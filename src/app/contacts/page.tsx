import Link from "next/link";

export default function ContactsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-2xl border border-indigo-100 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-black tracking-tight text-indigo-950">Contact Token Charity</h1>
        <p className="mt-3 text-slate-600">
          Thanks for reaching out. This project is currently run through the app routes below.
        </p>

        <ul className="mt-6 list-disc space-y-2 pl-5 text-slate-700">
          <li>
            Donate a provider key via <code>/donate</code>
          </li>
          <li>
            Register for a recipient key via <code>/register</code>
          </li>
          <li>
            Read the agent protocol at <code>/agents.md</code>
          </li>
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Back to home
          </Link>
          <Link
            href="/agents.md"
            className="rounded-xl border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            Open agents.md
          </Link>
        </div>
      </div>
    </main>
  );
}
