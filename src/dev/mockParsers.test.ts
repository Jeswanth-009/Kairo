/**
 * Unit tests for the dev-harness import parsers (src/dev/mockParsers.ts).
 * These mirror the real Rust heuristics in src-tauri/src/imports.rs; the
 * fixtures use the same fictional "Alex Rivera" persona as the rest of the
 * mock harness — never real personal data.
 */
import { describe, expect, it } from "vitest";
import { parseCertificate, parseGithubRepo, parseResume } from "./mockParsers";

const SAMPLE_RESUME = `Alex Rivera
Software Developer
alex.rivera@example.com | github.com/alex-rivera-dev
+91 9876543210

Summary
Systems and backend developer focused on data pipelines.

Experience
PyKV Cache Engine — Skilstack Academy
Jan 2025 - Present
Built an in-memory LRU cache with O(1) GET/SET and AOF persistence.
Benchmarked throughput at 708 ops/s under 20-way concurrency.

WatchDog — OpenForge '26
2024/06 - 2025/01
Reduced message delivery latency with per-room connection pooling.

Projects
Cert Ledger
Tech: Rust, SQLite, Tauri
Immutable certificate ledger with content-addressed storage.

Skills
Rust, Python, TypeScript, PostgreSQL, Docker
`;

describe("parseResume", () => {
  it("extracts profile contact fields", () => {
    const result = parseResume(SAMPLE_RESUME);
    expect(result.profile).not.toBeNull();
    expect(result.profile?.fullName).toBe("Alex Rivera");
    expect(result.profile?.email).toBe("alex.rivera@example.com");
    expect(result.profile?.phone).toContain("9876543210");
    expect(result.profile?.github).toBe("github.com/alex-rivera-dev");
  });

  it("finds both experience paragraphs with dates", () => {
    const result = parseResume(SAMPLE_RESUME);
    expect(result.experiences).toHaveLength(2);
    expect(result.experiences[0].role).toContain("PyKV");
    expect(result.experiences[0].startDate).toBe("2025-01");
    expect(result.experiences[0].isCurrent).toBe(true);
    expect(result.experiences[1].startDate).toBe("2024-06");
    expect(result.experiences[1].endDate).toBe("2025-01");
  });

  it("splits project skills from the Tech line", () => {
    const result = parseResume(SAMPLE_RESUME);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].title).toBe("Cert Ledger");
    expect(result.projects[0].skills).toEqual(["Rust", "SQLite", "Tauri"]);
  });

  it("tokenizes the skills section and categorizes languages", () => {
    const result = parseResume(SAMPLE_RESUME);
    const names = result.skills.map((s) => s.name);
    expect(names).toContain("Rust");
    expect(names).toContain("PostgreSQL");
    expect(result.skills.find((s) => s.name === "Rust")?.category).toBe("language");
    expect(result.skills.find((s) => s.name === "PostgreSQL")?.category).toBe("database");
  });

  it("returns empty candidates for text without recognizable sections", () => {
    const result = parseResume("just a random line without structure");
    expect(result.profile?.fullName).toBe("just a random line without structure");
    expect(result.experiences).toHaveLength(0);
    expect(result.projects).toHaveLength(0);
    expect(result.education).toHaveLength(0);
    expect(result.achievements).toHaveLength(0);
    expect(result.skills).toHaveLength(0);
  });
});

describe("parseCertificate", () => {
  it("extracts title, issuer and date", () => {
    const result = parseCertificate(
      "Certificate of Completion: Rust Fundamentals\nIssued by Skilstack Academy\nMarch 2025\nalex.rivera@example.com",
    );
    expect(result.title).toBe("Rust Fundamentals");
    expect(result.issuer).toBe("Skilstack Academy");
    expect(result.issueDate).toBe("2025-03");
    expect(result.email).toBe("alex.rivera@example.com");
  });
});

describe("parseGithubRepo", () => {
  it("builds a candidate from owner/repo without network access", () => {
    const result = parseGithubRepo("alex-rivera-dev", "cert-ledger");
    expect(result.repoUrl).toBe("https://github.com/alex-rivera-dev/cert-ledger");
    expect(result.title).toBe("Cert Ledger");
  });
});
