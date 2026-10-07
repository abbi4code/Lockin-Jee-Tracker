import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell, Stat } from "@/components/AdminParts";
import { StudentList, type StudentRow } from "@/components/admin/StudentList";
import { ago, formatMinutes, loadStudents, requireAdmin } from "@/lib/admin-data";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage() {
  if (!(await requireAdmin())) redirect("/today");
  const { students, error } = await loadStudents();
  const activeToday = students.filter((s) => s.streak.activeToday).length;
  const rows: StudentRow[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    lastActive: ago(s.lastActive),
    activeToday: s.streak.activeToday,
    streak: s.streak.days,
    study7: formatMinutes(s.study7),
    questions7: s.questions7,
    tests: s.testsGiven,
    college: s.college.today?.name ?? null,
    syllabus: s.overall.percent,
    done: `${s.overall.done}/${s.overall.total}`,
  }));

  return (
    <AdminShell title="admin">
      {error && (
        <p className="mt-6 rounded-lg border border-red/40 px-4 py-3 font-mono text-[13px] text-red">
          {error} — if a table is missing, run the files in supabase/migrations in the Supabase SQL editor.
        </p>
      )}
      <div className="grid grid-cols-3 gap-6 border-b border-line py-7">
        <Stat value={students.length} label="students" />
        <Stat value={activeToday} label="active today" />
        <Stat value={formatMinutes(students.reduce((n, s) => n + s.study7, 0))} label="studied this week, everyone" />
      </div>
      <StudentList rows={rows} />
    </AdminShell>
  );
}
