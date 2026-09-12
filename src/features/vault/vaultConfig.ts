import type { ComponentType, SVGProps } from "react";
import { IconJobs, IconResume, IconVault } from "../../components/icons";
import { fmtMonth, fmtRange } from "../../lib/dateFmt";
import type {
  Achievement,
  AnyVaultRecord,
  Certification,
  Education,
  EntityKey,
  Experience,
  Project,
} from "../../lib/types";

export type { EntityKey };

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "textarea" | "month" | "checkbox" | "url";
  required?: boolean;
  placeholder?: string;
  half?: boolean;
}

export interface EntityConfig {
  key: EntityKey;
  label: string;
  singular: string;
  addLabel: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  searchKeys: string[];
  fields: FieldDef[];
  hasSkills: boolean;
}

export const ENTITY_CONFIGS: Record<EntityKey, EntityConfig> = {
  projects: {
    key: "projects",
    label: "Projects",
    singular: "Project",
    addLabel: "Add project",
    icon: IconVault,
    searchKeys: ["title", "description"],
    hasSkills: true,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Problem, work performed, outcomes — factual language only.",
      },
      { name: "startDate", label: "Start", type: "month", half: true },
      { name: "isCurrent", label: "Ongoing", type: "checkbox", half: true },
      { name: "endDate", label: "End", type: "month", half: true },
      { name: "url", label: "Live URL", type: "url", placeholder: "https://…" },
      { name: "repoUrl", label: "Repository URL", type: "url", placeholder: "https://github.com/…" },
    ],
  },
  experiences: {
    key: "experiences",
    label: "Experience",
    singular: "Experience",
    addLabel: "Add experience",
    icon: IconJobs,
    searchKeys: ["organization", "role", "description"],
    hasSkills: true,
    fields: [
      { name: "organization", label: "Organization", type: "text", required: true },
      { name: "role", label: "Role", type: "text", required: true },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Responsibilities and outcomes — factual language only.",
      },
      { name: "startDate", label: "Start", type: "month", half: true },
      { name: "isCurrent", label: "Current", type: "checkbox", half: true },
      { name: "endDate", label: "End", type: "month", half: true },
      { name: "location", label: "Location", type: "text" },
    ],
  },
  education: {
    key: "education",
    label: "Education",
    singular: "Education",
    addLabel: "Add education",
    icon: IconResume,
    searchKeys: ["institution", "degree", "fieldOfStudy"],
    hasSkills: false,
    fields: [
      { name: "institution", label: "Institution", type: "text", required: true },
      { name: "degree", label: "Degree", type: "text", required: true },
      { name: "fieldOfStudy", label: "Field of study", type: "text" },
      { name: "description", label: "Notes", type: "textarea" },
      { name: "startDate", label: "Start", type: "month", half: true },
      { name: "isCurrent", label: "Ongoing", type: "checkbox", half: true },
      { name: "endDate", label: "End", type: "month", half: true },
    ],
  },
  certifications: {
    key: "certifications",
    label: "Certifications",
    singular: "Certification",
    addLabel: "Add certification",
    icon: IconResume,
    searchKeys: ["title", "issuer", "credentialId"],
    hasSkills: false,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "issuer", label: "Issuer", type: "text", required: true },
      { name: "description", label: "Notes", type: "textarea" },
      { name: "issueDate", label: "Issued", type: "month", half: true },
      { name: "expiryDate", label: "Expires", type: "month", half: true },
      { name: "credentialId", label: "Credential ID", type: "text" },
      { name: "url", label: "Verification URL", type: "url", placeholder: "https://…" },
    ],
  },
  achievements: {
    key: "achievements",
    label: "Achievements",
    singular: "Achievement",
    addLabel: "Add achievement",
    icon: IconVault,
    searchKeys: ["title", "issuer", "description"],
    hasSkills: false,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "issuer", label: "Awarded by", type: "text" },
      { name: "achievedOn", label: "Date", type: "month" },
      { name: "description", label: "Description", type: "textarea" },
    ],
  },
};

export function subtitleOf(key: EntityKey, record: AnyVaultRecord): string {
  switch (key) {
    case "experiences": {
      const r = record as Experience;
      return [r.organization, r.role].filter(Boolean).join(" · ");
    }
    case "education": {
      const r = record as Education;
      return [r.degree, r.fieldOfStudy].filter(Boolean).join(" · ");
    }
    case "certifications":
      return (record as Certification).issuer;
    case "achievements":
      return (record as Achievement).issuer;
    default:
      return "";
  }
}

export function rangeOf(key: EntityKey, record: AnyVaultRecord): string {
  switch (key) {
    case "projects": {
      const r = record as Project;
      return fmtRange({ startDate: r.startDate, endDate: r.endDate, isCurrent: r.isCurrent });
    }
    case "experiences": {
      const r = record as Experience;
      return fmtRange({ startDate: r.startDate, endDate: r.endDate, isCurrent: r.isCurrent });
    }
    case "education": {
      const r = record as Education;
      return fmtRange({ startDate: r.startDate, endDate: r.endDate, isCurrent: r.isCurrent });
    }
    case "certifications": {
      const r = record as Certification;
      const issue = fmtMonth(r.issueDate);
      const expiry = r.expiryDate ? `Expires ${fmtMonth(r.expiryDate)}` : "";
      return [issue, expiry].filter(Boolean).join(" · ");
    }
    case "achievements":
      return fmtMonth((record as Achievement).achievedOn);
    default:
      return "";
  }
}

export function descriptionOf(record: AnyVaultRecord): string {
  return (record as { description?: string }).description ?? "";
}

export function linksOf(record: AnyVaultRecord): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if ("url" in record && record.url) out.push({ label: "Link", url: record.url });
  if ("repoUrl" in record && record.repoUrl) out.push({ label: "Repository", url: record.repoUrl });
  return out;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Client-side mirror of the server validation, for inline field errors. */
export function validateValues(
  fields: FieldDef[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === "text" || field.type === "textarea") {
      if (field.required && !String(value ?? "").trim()) {
        errors[field.name] = `${field.label} is required`;
      }
    } else if (field.type === "month" && typeof value === "string" && value) {
      if (!MONTH_RE.test(value)) {
        errors[field.name] = "Use YYYY-MM";
      } else if (field.name === "endDate" || field.name === "expiryDate") {
        const startName = field.name === "endDate" ? "startDate" : "issueDate";
        const start = values[startName];
        if (typeof start === "string" && start && value < start) {
          errors[field.name] = "Cannot be before the start";
        }
      }
    } else if (field.type === "url" && typeof value === "string" && value.trim()) {
      if (!/^https?:\/\//.test(value.trim())) {
        errors[field.name] = "Must start with http:// or https://";
      }
    }
  }
  return errors;
}
