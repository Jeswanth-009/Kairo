/**
 * Dev-only heuristic parsers behind the mock IPC import commands. The real
 * extraction lives in the Rust backend (`src-tauri/src/imports.rs`); these are
 * honest stand-ins for the `?mock` browser harness — candidates are derived
 * from the pasted text, nothing is invented. Pure functions, unit-tested.
 */
import type {
  AchievementDraft,
  CertificateCandidate,
  EducationDraft,
  ExperienceDraft,
  GithubRepoCandidate,
  ImportProfile,
  ProjectDraft,
  ResumeImport,
  SkillCategory,
  SkillDraft,
} from "../lib/types";

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,15}\d/;
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTHS = MONTH_NAMES.join("|");
const DATE_TOKEN_RE = new RegExp(
  String.raw`(?:19|20)\d{2}\s*[-/]\s*(?:0?[1-9]|1[0-2])` +
    String.raw`|(?:${MONTHS})[a-z]*\.?\s+(?:19|20)\d{2}` +
    String.raw`|(?:19|20)\d{2}`,
  "i",
);

const HEADING_PATTERNS: [RegExp, SectionName][] = [
  [/^(?:work\s+|professional\s+)?experience|employment|work\s+history/i, "experience"],
  [/^projects?|selected\s+projects/i, "projects"],
  [/^education(?:al)?(?:\s+background)?/i, "education"],
  [/^(?:technical\s+)?skills|technologies/i, "skills"],
  [/^achievements?|awards?|honors?|certificates?|certifications?/i, "achievements"],
  [/^summary|objective|profile|about/i, "summary"],
];

type SectionName = "experience" | "projects" | "education" | "skills" | "achievements" | "summary";

const isHeading = (line: string): SectionName | null => {
  const bare = line.replace(/^#+\s*/, "").replace(/[:_*-]+$/, "").trim();
  if (bare.length === 0 || bare.length > 32) return null;
  for (const [re, name] of HEADING_PATTERNS) {
    if (re.test(bare)) return name;
  }
  return null;
};

const splitSections = (text: string): Map<SectionName, string[]> => {
  const sections = new Map<SectionName, string[]>();
  let current: SectionName | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = isHeading(line);
    if (heading) {
      current = heading;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(raw);
  }
  return sections;
};

const splitParagraphs = (lines: string[]): string[][] => {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (current.length > 0) paragraphs.push(current);
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
};

const normalizeDate = (token: string): string | null => {
  const t = token.trim();
  const yearMonth = t.match(/((?:19|20)\d{2})\s*[-/]\s*(0?[1-9]|1[0-2])/);
  if (yearMonth) {
    const month = String(Number(yearMonth[2])).padStart(2, "0");
    return `${yearMonth[1]}-${month}`;
  }
  const monthYear = t.match(new RegExp(`(${MONTHS})[a-z]*\\.?\\s+((?:19|20)\\d{2})`, "i"));
  if (monthYear) {
    const abbr = monthYear[1].toLowerCase().slice(0, 3);
    const monthIndex = MONTH_NAMES.indexOf(abbr);
    const month = monthIndex >= 0 ? String(monthIndex + 1).padStart(2, "0") : "01";
    return `${monthYear[2]}-${month}`;
  }
  const yearOnly = t.match(/((?:19|20)\d{2})/);
  return yearOnly ? `${yearOnly[1]}-01` : null;
};

const findAllDates = (text: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(DATE_TOKEN_RE.source, "gi");
  for (const match of text.matchAll(re)) {
    const normalized = normalizeDate(match[0]);
    if (normalized) out.push(normalized);
  }
  return out;
};

const snippet = (text: string, max = 160): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

const CATEGORY_HINTS: [RegExp, SkillCategory][] = [
  [/\b(rust|python|typescript|javascript|java|c\+\+|go|sql)\b/i, "language"],
  [/\b(react|next\.?js|tauri|fastapi|node\.?js|django|flask|express)\b/i, "framework"],
  [/\b(postgres(?:ql)?|mysql|mongodb|sqlite|redis)\b/i, "database"],
  [/\b(docker|kubernetes|git|linux)\b/i, "devops"],
  [/\b(aws|azure|gcp)\b/i, "cloud"],
];

const categorize = (name: string): SkillCategory => {
  for (const [re, category] of CATEGORY_HINTS) {
    if (re.test(name)) return category;
  }
  return "other";
};

export function parseResume(text: string): ResumeImport {
  const sections = splitSections(text);
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const email = text.match(EMAIL_RE)?.[0] ?? "";
  const phone = text.match(PHONE_RE)?.[0]?.trim() ?? "";
  let fullName = "";
  for (const line of lines) {
    if (!line || line === email || isHeading(line) || EMAIL_RE.test(line) || /\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 1 && words.length <= 6 && line.length <= 60) {
      fullName = line;
      break;
    }
  }
  const headlineIdx = lines.findIndex((l) => l === fullName);
  const headline =
    lines
      .slice(headlineIdx + 1)
      .find((l) => l && l !== email && l !== phone && l.length <= 90 && !isHeading(l)) ?? "";
  const summaryText = (sections.get("summary") ?? []).join(" ").trim();

  const profile: ImportProfile | null =
    fullName || email || phone || headline || summaryText
      ? {
          fullName,
          headline,
          email,
          phone,
          github: text.match(/github\.com\/[\w-]+/i)?.[0] ?? "",
          website: text.match(/https?:\/\/(?!.*(?:github|linkedin))[\w.-]+\.\w{2,}[^\s)]*/i)?.[0] ?? "",
          linkedin: text.match(/linkedin\.com\/in\/[\w-]+/i)?.[0] ?? "",
          summary: summaryText.slice(0, 280),
        }
      : null;

  const experiences: ExperienceDraft[] = splitParagraphs(sections.get("experience") ?? []).map((p) => {
    const [titleLine, ...rest] = p;
    const split = titleLine.split(/\s+(?:at|@|—|–|\||,)\s+|,\s+/);
    const dates = findAllDates(p.join("\n"));
    const raw = p.join("\n");
    return {
      organization: split.slice(1).join(", ").trim(),
      role: split[0].trim(),
      description: rest.join("\n"),
      startDate: dates[0] ?? null,
      endDate: dates[1] ?? null,
      isCurrent: /\bpresent\b|\bcurrent\b/i.test(raw) && dates.length < 2,
      location: "",
      sourceSnippet: snippet(raw),
    };
  });

  const projects: ProjectDraft[] = splitParagraphs(sections.get("projects") ?? []).map((p) => {
    const [titleLine, ...rest] = p;
    const techLine = rest.find((l) => /^(tech|stack|technologies)\s*:/i.test(l));
    const skills = techLine
      ? techLine
          .split(/:/)[1]
          .split(/[,•·|]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= 30)
      : [];
    return {
      title: titleLine.replace(/^[-•*]\s*/, ""),
      description: rest.filter((l) => l !== techLine).join("\n"),
      skills,
      sourceSnippet: snippet(p.join("\n")),
    };
  });

  const education: EducationDraft[] = splitParagraphs(sections.get("education") ?? []).map((p) => {
    const raw = p.join("\n");
    const dates = findAllDates(raw);
    const degreeMatch = raw.match(
      /(b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|bachelor(?:'s)?|master(?:'s)?|ph\.?\s?d|diploma)[^,\n]*/i,
    );
    const degreeLine = p.find((l) => /b\.?\s?tech|m\.?\s?tech|bachelor|master|ph\.?\s?d|diploma/i.test(l)) ?? p[0];
    const fieldMatch = degreeLine.match(/\bin\s+(.+?)(?:\s*[,(]|\s*$)/i);
    return {
      institution: p.find((l) => /university|college|institute|school|academy/i.test(l)) ?? p[0],
      degree: degreeMatch?.[0].trim() ?? degreeLine,
      fieldOfStudy: fieldMatch?.[1]?.trim() ?? "",
      startDate: dates[0] ?? null,
      endDate: dates[1] ?? null,
      isCurrent: /\bpresent\b|\bexpected\b/i.test(raw) && dates.length < 2,
      sourceSnippet: snippet(raw),
    };
  });

  const achievements: AchievementDraft[] = splitParagraphs(sections.get("achievements") ?? []).map((p) => {
    const [titleLine, ...rest] = p;
    const raw = p.join("\n");
    const date = findAllDates(raw)[0] ?? null;
    const issuerLine = rest.find((l) => !findAllDates(l).length && l.length <= 60);
    return {
      title: titleLine.replace(/^[-•*]\s*/, ""),
      issuer: issuerLine && !/^(description|for)\b/i.test(issuerLine) ? issuerLine : "",
      description: rest.filter((l) => l !== issuerLine).join("\n"),
      achievedOn: date,
      sourceSnippet: snippet(raw),
    };
  });

  const skills: SkillDraft[] = Array.from(
    new Set(
      (sections.get("skills") ?? [])
        .join("\n")
        .split(/[,•·|\n]/)
        .map((s) => s.replace(/^[-*]\s*/, "").trim())
        .filter((s) => s.length > 0 && s.length <= 40 && !/^(tech|stack|technologies)\s*:/i.test(s)),
    ),
  ).map((name) => ({ name, category: categorize(name) }));

  return { profile, projects, experiences, education, achievements, skills };
}

export function parseCertificate(text: string): CertificateCandidate {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const issuer = text.match(/issued (?:by|through|at)\s+([^\n,;]+)/i)?.[1]?.trim() ?? "";
  return {
    title: lines[0]?.replace(/^certificate(?: of completion)?[:\s-]*/i, "") ?? "",
    issuer,
    issueDate: findAllDates(text)[0] ?? null,
    email: text.match(EMAIL_RE)?.[0] ?? "",
    sourceSnippet: snippet(text, 200),
  };
}

export function parseGithubRepo(owner: string, repo: string): GithubRepoCandidate {
  const url = `https://github.com/${owner}/${repo}`;
  const title = repo
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return {
    title,
    description:
      "Mock preview — the desktop app fetches the live repository description, topics and README before creating a candidate.",
    url,
    repoUrl: url,
    startDate: null,
    skills: [],
    sourcePreview: `${owner}/${repo} — stars, forks, topics and README excerpt appear here in the desktop app.`,
  };
}
