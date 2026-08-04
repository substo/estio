"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LocationSessionDetail } from "@/lib/team/location-session-access";

type AccessMember = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  lastSeenAt: string | null;
  recentlyActive: boolean;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function SessionView({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sessions, setSessions] = useState<LocationSessionDetail[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  async function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || loaded) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/team/location-sessions?userId=${encodeURIComponent(userId)}`);
      if (!response.ok) throw new Error("Session request failed");
      const body = await response.json() as {
        sessions?: LocationSessionDetail[];
        unavailable?: boolean;
      };
      setSessions(body.sessions || []);
      setUnavailable(Boolean(body.unavailable));
      setLoaded(true);
    } catch {
      setUnavailable(true);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sm:col-span-4">
      <Button type="button" variant="outline" size="sm" onClick={toggle} aria-expanded={open}>
        {open ? "Hide sessions" : "View sessions"}
      </Button>
      {open && (
        <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
          {loading && <p className="text-sm text-muted-foreground">Loading session details…</p>}
          {!loading && unavailable && (
            <p className="text-sm text-muted-foreground">Session details are temporarily unavailable.</p>
          )}
          {!loading && !unavailable && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No recorded sessions are available.</p>
          )}
          {!loading && !unavailable && sessions.map((session) => (
            <div key={session.id} className="grid gap-2 rounded-md border bg-background p-3 text-sm sm:grid-cols-3">
              <div><span className="text-muted-foreground">Device</span><p>{session.deviceType}</p></div>
              <div><span className="text-muted-foreground">Browser</span><p>{session.browser}</p></div>
              <div><span className="text-muted-foreground">Approximate location</span><p>{session.city}, {session.country}</p></div>
              <div><span className="text-muted-foreground">First access to this location</span><p>{formatDate(session.firstSeenAt)}</p></div>
              <div><span className="text-muted-foreground">Last activity</span><p>{formatDate(session.lastSeenAt)}</p></div>
              <div><span className="text-muted-foreground">Clerk session status</span><p>{session.status === "active" ? "Active sign-in" : session.status}</p></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccessSessionsSection({ members }: { members: AccessMember[] }) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Access &amp; sessions</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Review when team members accessed this location and their location-filtered Estio sessions.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/user-profile">Manage my devices</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {members.map((member) => (
          <div key={member.id} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4 sm:items-center">
            <div className="sm:col-span-2">
              <p className="font-medium">{member.name}</p>
              <p className="text-sm text-muted-foreground">{member.email}</p>
            </div>
            <div><Badge variant="outline">{member.role === "ADMIN" ? "Admin" : "Member"}</Badge></div>
            <div className="text-sm">
              {member.lastSeenAt ? (
                <>
                  <p>{formatDate(member.lastSeenAt)}</p>
                  {member.recentlyActive && <p className="font-medium text-green-700">Recently active</p>}
                </>
              ) : <p className="text-muted-foreground">No recorded activity</p>}
            </div>
            <SessionView userId={member.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
