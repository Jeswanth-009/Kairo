import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Textarea } from "../../components/ui/inputs";
import type { Profile } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";

const URL_FIELDS: { name: keyof Profile; label: string }[] = [
  { name: "website", label: "Website" },
  { name: "github", label: "GitHub URL" },
  { name: "linkedin", label: "LinkedIn URL" },
];

/**
 * Shared profile editor (Vault + Resume Studio). Saves through the vault
 * store; `onSaved` lets callers react — the Studio merges the new contact
 * header into the plan snapshot so the next export picks it up immediately.
 */
export function ProfileDialog({
  open,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: Profile;
  onClose: () => void;
  onSaved?: (profile: Profile) => void;
}) {
  const saveProfile = useVaultStore((s) => s.saveProfile);
  const [values, setValues] = useState<Profile>(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (name: keyof Profile, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const save = async () => {
    const nextErrors: Record<string, string> = {};
    if (!values.fullName.trim()) nextErrors.fullName = "Name is required";
    if (!values.email.trim()) nextErrors.email = "Email is required";
    for (const { name, label } of URL_FIELDS) {
      const url = values[name].trim();
      if (url && !/^https?:\/\//.test(url)) nextErrors[name] = `${label} must start with http:// or https://`;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await saveProfile(values);
      toast.ok("Profile saved");
      onSaved?.(values);
      onClose();
    } catch (e) {
      setServerError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const text = (name: keyof Profile, label: string, required = false, placeholder = "") => (
    <Field label={label} required={required} error={errors[name]}>
      <Input
        value={values[name]}
        placeholder={placeholder}
        error={!!errors[name]}
        onChange={(e) => set(name, e.target.value)}
      />
    </Field>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Edit profile">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {serverError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{serverError}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div>{text("fullName", "Full name", true, "Your Name")}</div>
          <div>{text("headline", "Headline", false, "Backend engineer · CS student")}</div>
          <div>{text("email", "Email", true, "you@example.com")}</div>
          <div>{text("phone", "Phone")}</div>
          <div>{text("location", "Location")}</div>
          <div>{text("website", "Website")}</div>
          <div>{text("github", "GitHub URL")}</div>
          <div>{text("linkedin", "LinkedIn URL")}</div>
        </div>
        <Field label="Summary" hint="Factual, one or two sentences">
          <Textarea
            value={values.summary}
            placeholder="What you build and what you are looking for."
            onChange={(e) => set("summary", e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
