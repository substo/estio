import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft, Building2, Globe, Mail, Phone } from "lucide-react";

import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteCompanyDialog } from "../../_components/delete-company-dialog";

export const dynamic = "force-dynamic";

export default async function CompanyViewPage(props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ locationId?: string }>;
}) {
    const { id } = await props.params;
    const { locationId: searchLocationId } = await props.searchParams;

    const locationCtx = await getLocationContext();
    const locationId = searchLocationId || locationCtx?.id;

    if (!locationId) {
        return <div className="p-6">No location context found.</div>;
    }

    const { userId } = await auth();
    if (!userId) {
        return <div className="p-6">Unauthorized.</div>;
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return <div className="p-6">Unauthorized: You do not have access to this location.</div>;
    }

    const company = await db.company.findFirst({
        where: {
            id,
            locationId,
        },
        include: {
            propertyRoles: {
                include: {
                    property: {
                        select: {
                            id: true,
                            title: true,
                            reference: true,
                            city: true,
                        },
                    },
                },
                orderBy: [{ role: "asc" }, { createdAt: "desc" }],
            },
            contactRoles: {
                include: {
                    contact: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            contactType: true,
                        },
                    },
                },
                orderBy: [{ role: "asc" }, { createdAt: "desc" }],
            },
            feeds: {
                select: {
                    id: true,
                    url: true,
                    format: true,
                    isActive: true,
                    lastSyncAt: true,
                },
                orderBy: [{ createdAt: "desc" }],
            },
        },
    });

    if (!company) {
        return <div className="p-6">Company not found.</div>;
    }

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <Button variant="ghost" asChild>
                    <Link href="/admin/companies">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Companies
                    </Link>
                </Button>
                <div className="flex items-center gap-2">
                    <Badge variant="outline">{company.type || "Company"}</Badge>
                    <DeleteCompanyDialog
                        triggerVariant="button"
                        company={{
                            id: company.id,
                            name: company.name,
                            locationId: company.locationId,
                            propertyRoleCount: company.propertyRoles.length,
                            contactRoleCount: company.contactRoles.length,
                            feedCount: company.feeds.length,
                        }}
                        redirectTo={`/admin/companies?locationId=${encodeURIComponent(company.locationId)}`}
                    />
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-slate-600" />
                        {company.name}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.email ? (
                        <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-slate-500" />
                            <span className="break-all">{company.email}</span>
                        </div>
                    ) : null}
                    {company.phone ? (
                        <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-slate-500" />
                            <span>{company.phone}</span>
                        </div>
                    ) : null}
                    {company.website ? (
                        <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-slate-500" />
                            <a
                                href={company.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline break-all"
                            >
                                {company.website}
                            </a>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Property Relations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.propertyRoles.length === 0 ? (
                        <div className="text-muted-foreground">No property relations linked.</div>
                    ) : (
                        company.propertyRoles.map((role) => (
                            <div key={role.id} className="flex items-center justify-between gap-3 rounded border p-2">
                                <Link
                                    href={`/admin/properties/${encodeURIComponent(role.property.id)}/view`}
                                    className="text-primary hover:underline truncate"
                                    title={role.property.title}
                                >
                                    {role.property.reference || role.property.title}
                                </Link>
                                <Badge variant="secondary" className="shrink-0">
                                    {role.role}
                                </Badge>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Contact Relations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.contactRoles.length === 0 ? (
                        <div className="text-muted-foreground">No contact relations linked.</div>
                    ) : (
                        company.contactRoles.map((role) => (
                            <div key={role.id} className="rounded border p-2 space-y-1">
                                <div className="flex items-center justify-between gap-3">
                                    <Link
                                        href={`/admin/contacts/${encodeURIComponent(role.contact.id)}/view`}
                                        className="text-primary hover:underline truncate"
                                        title={role.contact.name || role.contact.email || role.contact.phone || "Contact"}
                                    >
                                        {role.contact.name || role.contact.email || role.contact.phone || "Unnamed Contact"}
                                    </Link>
                                    <Badge variant="secondary" className="shrink-0">
                                        {role.role}
                                    </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                                    {role.contact.contactType ? <span>Type: {role.contact.contactType}</span> : null}
                                    {role.contact.email ? <span>{role.contact.email}</span> : null}
                                    {role.contact.phone ? <span>{role.contact.phone}</span> : null}
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Feeds</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.feeds.length === 0 ? (
                        <div className="text-muted-foreground">No feeds configured.</div>
                    ) : (
                        company.feeds.map((feed) => (
                            <div key={feed.id} className="rounded border p-2 space-y-1">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="truncate" title={feed.url}>{feed.url}</span>
                                    <Badge variant={feed.isActive ? "default" : "secondary"} className="shrink-0">
                                        {feed.isActive ? "Active" : "Inactive"}
                                    </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    Format: {feed.format}
                                    {feed.lastSyncAt ? ` · Last Sync: ${new Date(feed.lastSyncAt).toLocaleString()}` : " · Never synced"}
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
