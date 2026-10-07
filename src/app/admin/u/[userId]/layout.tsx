import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/AdminParts";
import { StudentTabs } from "@/components/admin/StudentTabs";
import { ago, requireAdmin } from "@/lib/admin-data";
import { loadStudent } from "@/lib/admin-student";
import { streak } from "@/lib/stats";

/** Every student page: who it is, when they were last active, and the section tabs. */
export default async function StudentLayout({ children, params }: LayoutProps<"/admin/u/[userId]">) {
  if (!(await requireAdmin())) redirect("/today");
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const st = streak(s.activity);
  const inactive = !st.activeToday;

  return (
    <AdminShell title="student" back={{ href: "/admin", label: "all students" }} chatWith={{ id: s.id, name: s.name }}>
      <header className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-5">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-tight font-semibold tracking-tight lg:text-[40px]">{s.name}</h1>
          <p className="mt-1.5 font-mono text-[12.5px] text-mute">
            {s.email} · {s.exam === "main" ? "main only" : "main + advanced"} · joined {new Date(s.joined).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <div className="text-right font-mono text-[12.5px]">
          <div className={inactive ? "text-red" : "text-fg"}>{st.activeToday ? "active today" : `last active ${ago(s.lastActive)}`}</div>
          <div className="mt-1 text-dim">
            {st.days}-day streak{st.atRisk ? " · at risk" : ""}
          </div>
        </div>
      </header>
      <StudentTabs id={s.id} />
      <div className="pt-6">{children}</div>
    </AdminShell>
  );
}
