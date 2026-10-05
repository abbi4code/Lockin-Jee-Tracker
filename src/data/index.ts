import raw from "./jee.json";

export type SubjectId = "physics" | "chemistry" | "maths";
export type Exam = "main" | "advanced";

export interface Topic {
  name: string;
  inMain: boolean;
  inAdv: boolean;
  mainNote?: string;
  mainQs?: number | null;
}

export interface Chapter {
  id: string;
  name: string;
  unit: string;
  branch: "physical" | "organic" | "inorganic" | null;
  cls: 11 | 12;
  inMain: boolean;
  inAdv: boolean;
  difficulty: number | null;
  ncertCritical: boolean;
  notes: string | null;
  prereqs: string[];
  topics: Topic[];
  weight?: {
    main: number | null;
    adv: number | null;
    mainByYear: Record<string, number | null>;
    highYield: boolean;
    roi: number | null;
    roiReason: string | null;
    confidence: string;
  };
  res?: {
    videos: { title: string; url: string; yt: string | null; channel: string; lang: string; duration: string | null }[];
    notes: { title: string; url: string }[];
    ncertUseful: boolean | null;
    books: { name: string; section: string | null }[];
  };
}

export interface Subject {
  id: SubjectId;
  name: string;
  short: string;
  units: { id: string; name: string }[];
  chapters: Chapter[];
}

export interface ExamDate {
  event: string;
  start: string;
  end: string;
  status: string;
}

/** A MathonGo test-series chapter; it can cover several app chapters. */
export interface Track {
  id: string;
  subject: SubjectId;
  name: string;
  chapterIds: string[];
  tests: number;
  pyqTests: number | null;
  removedFromMain: boolean;
}

interface JeeData {
  generatedAt: string;
  exams: ExamDate[];
  subjects: Subject[];
  tracks: Track[];
}

const DATA = raw as unknown as JeeData;

export const SUBJECTS = DATA.subjects;
export const TRACKS = DATA.tracks;
export const getTrack = (id: string) => TRACKS.find((t) => t.id === id);
/** MathonGo tracks that cover a chapter (usually one; a few chapters share tests). */
export const tracksForChapter = (chapterId: string) => TRACKS.filter((t) => t.chapterIds.includes(chapterId));
export const EXAMS = DATA.exams;

export const SUBJECT_COLOR: Record<SubjectId, string> = {
  physics: "var(--color-phy)",
  chemistry: "var(--color-chem)",
  maths: "var(--color-math)",
};

export const SUBJECT_EMOJI: Record<SubjectId, string> = {
  physics: "⚡",
  chemistry: "🧪",
  maths: "∞",
};

export const ALL_CHAPTERS = SUBJECTS.flatMap((s) => s.chapters.map((c) => ({ ...c, subject: s.id })));
const BY_ID = new Map(ALL_CHAPTERS.map((c) => [c.id, c]));

export const getChapter = (id: string) => BY_ID.get(id);
export const getSubject = (id: string) => SUBJECTS.find((s) => s.id === id);

/** Main mode hides Advanced-only material; "Main + Adv" shows everything (Advanced aspirants sit Main too). */
export const chapterInScope = (c: Chapter, exam: Exam) => (exam === "main" ? c.inMain : true);
export const topicInScope = (t: Topic, exam: Exam) => (exam === "main" ? t.inMain : true);

export function findExam(match: RegExp) {
  return EXAMS.find((e) => match.test(e.event));
}
