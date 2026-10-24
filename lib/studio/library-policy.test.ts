import assert from "node:assert/strict";
import test from "node:test";
import { readLibraryDraft, safeStudioSourceUrl } from "./library-policy";
import { studioInvitationStatus, type StudioInvitationState } from "./invitation-policy";

test("Library edits retain exact transcript and only patch submitted fields", () => {
  const form = new FormData();
  form.set("title", "Source"); form.set("kind", "reference"); form.set("transcript", "Exact words\n  punctuation…");
  const draft = readLibraryDraft(form);
  assert.equal(draft.payload.transcript, "Exact words\n  punctuation…");
  assert.equal(Object.hasOwn(draft.payload,"notes"), false);
  assert.equal(Object.hasOwn(draft.payload,"approved"), false);
  form.set("url", "javascript:alert(1)");
  assert.throws(() => readLibraryDraft(form), /HTTP/);
  assert.equal(safeStudioSourceUrl("https://name:secret@example.com"), null);
});

test("Invitations show expired/revoked/other-account states without permitting acceptance", () => {
  const invitation: StudioInvitationState = { email:"a@example.com",expires_at:"2030-01-01T00:00:00Z",revoked_at:null,accepted_at:null,accepted_by_clerk_user_id:null };
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(studioInvitationStatus(invitation,"user-a",now),"pending");
  assert.equal(studioInvitationStatus({...invitation,expires_at:"bad"},"user-a",now),"invalid");
  assert.equal(studioInvitationStatus({...invitation,revoked_at:"2025-01-01"},"user-a",now),"invalid");
  assert.equal(studioInvitationStatus({...invitation,accepted_at:"2025-01-01",accepted_by_clerk_user_id:"user-b"},"user-a",now),"used");
  assert.equal(studioInvitationStatus({...invitation,accepted_at:"2025-01-01",accepted_by_clerk_user_id:"user-a"},"user-a",now),"accepted");
});
