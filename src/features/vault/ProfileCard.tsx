import { useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import type { Profile } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { ProfileDialog } from "./ProfileDialog";

const EMPTY_PROFILE: Profile = {
  fullName: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  website: "",
  github: "",
  linkedin: "",
  summary: "",
};

export function ProfileCard() {
  const profile = useVaultStore((s) => s.profile);
  const [editing, setEditing] = useState(false);
  const hasProfile = !!profile && (profile.fullName.trim() !== "" || profile.email.trim() !== "");

  const contacts = profile
    ? [profile.email, profile.phone, profile.location].filter((v) => v.trim() !== "")
    : [];

  return (
    <>
      <Card className="mb-6 flex items-start gap-4 p-6">
        <div className="mt-0.5 shrink-0">
          <BrandMark size={40} />
        </div>
        <div className="min-w-0 flex-1">
          {hasProfile && profile ? (
            <>
              <h2 className="text-sm font-semibold text-ink">{profile.fullName}</h2>
              {profile.headline ? (
                <p className="text-xs text-muted">{profile.headline}</p>
              ) : null}
              {contacts.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {contacts.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink ring-1 ring-line"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
              {profile.summary ? (
                <p className="mt-2 text-sm leading-relaxed text-muted">{profile.summary}</p>
              ) : null}
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">Tell Kairo who you are</h2>
              <p className="mt-1 text-sm text-muted">
                Your profile sits at the root of the Vault and heads every resume.
              </p>
            </>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {hasProfile ? "Edit profile" : "Set up profile"}
        </Button>
      </Card>

      <ProfileDialog
        open={editing}
        profile={profile ?? EMPTY_PROFILE}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
