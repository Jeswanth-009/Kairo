# Usability testing protocol

Before calling the overhaul successful, run these sessions with real people and record what
happens. This file defines what to measure — the numbers below are blank on purpose. Do not
estimate them from the code; they only mean something when observed.

## Sessions

| Session | Participant | Task |
|---|---|---|
| S1 | Brand-new user, has a resume file | Install, reach a reviewable first PDF |
| S2 | Brand-new user, resume is a scanned image | Same — exercises the failure paths |
| S3 | Returning user with a populated Vault | Tailor a resume for a second, different role |
| S4 | Any user | Restore yesterday's backup, then open the restored PDFs |

Five participants per scenario is enough to surface the dominant problems (Nielsen); record
screen + audio, ask them to think aloud, and never help before they have failed visibly for a
minute.

## Measurements

### Time to first PDF (S1, S2)
- Start: app opened. Stop: the compiled PDF is on screen in onboarding.
- Record: minutes, and where the time went (import, review, path choice, compile).

### Hesitation and abandonment (all sessions)
- Every screen where the participant stops, scrolls back, or asks "what does this mean?".
- Whether S2 finds the manual-entry path without help.
- Whether anyone leaves onboarding and successfully resumes (the persisted step should make
  this boring — note if it is not).

### Corrections (S1)
- Which extracted facts they edit before saving (field-level: dates? titles? skills?).
- Which groups they dismiss entirely.
- Whether the source passage ("From your resume: …") is used — do they trust it, check it,
  or ignore it?

### Suggestion and evidence decisions (S3)
- Suggestions accepted / edited / dismissed counts per session.
- In the Evidence stage: how many requirements get an explicit Use/Dismiss decision before
  the participant moves on; whether "Find another example" is discovered; whether "missing"
  requirements are understood as honest gaps rather than a bug.

### Language comprehension (all sessions)
Ask, in the participant's own words, at the end:
- What does "Current PDF" mean? (Correct: the displayed file was built from the latest
  saved draft.)
- What does "Reviewed" mean? (Correct: you looked at that exact file and Kairo recorded its
  fingerprint; a new export resets it.)
- What does "Sent version v2" mean in Applications? (Correct: this tracked application is
  linked to that exact PDF.)

### PDF problems noticed (S1, S3)
- Anything they flag in the rendered output: overflow, clipping, spacing, template quirks.
- Whether the page-fit warning and the review-checklist page-count line match what they see.

## Results log

| Date | Session | Participant | Time to first PDF | Exits/hesitations | Corrections | Decisions (use/dismiss/edit) | Comprehension failures | PDF issues |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

Fill this table per participant, then summarize the top three fixes before the next round.
