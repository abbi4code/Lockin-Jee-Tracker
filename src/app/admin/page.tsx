import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell, Stat, StudentCard } from "@/components/AdminParts";
import { formatMinutes, loadStudents, requireAdmin } from "@/lib/admin-data";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage() {
  if (!(await requireAdmin())) redirect("/today");
  const { students, error } = await loadStudents();
  const activeToday = students.filter((s) => s.streak.activeToday).length;
  const minutesToday = students.reduce((n, s) => n + s.minutesToday, 0);

  return (
    <AdminShell title="admin">
      {error && (
        <p className="mt-6 rounded-lg border border-red/40 px-4 py-3 font-mono text-[13px] text-red">
          {error} — if a table is missing, run supabase/schema.sql in the Supabase SQL editor.
        </p>
      )}
      <div className="grid grid-cols-3 gap-6 border-b border-line py-7">
        <Stat value={students.length} label="accounts" />
        <Stat value={activeToday} label="active today" />
        <Stat value={formatMinutes(minutesToday)} label="focus today, everyone" />
      </div>
      {students.length === 0 ? <p className="py-16 text-center font-mono text-[13px] text-dim">no accounts yet.</p> : students.map((s) => <StudentCard key={s.id} s={s} />)}
    </AdminShell>
  );
}
