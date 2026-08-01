import Link from "next/link";
import { ArrowLeft, Building2, Globe, Mail, Phone } from "lucide-react";
import { notFound } from "next/navigation";

import db from "@/lib/db";
import { safeCompanyWebsite } from "@/lib/companies/repository";
import { buildContactVisibilityWhere, getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteCompanyDialog } from "../../_components/delete-company-dialog";
import { FeedManager } from "../../_components/feed-manager";

export const dynamic = "force-dynamic";

export default async function CompanyViewPage(props: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await props.params;

    const access = await getActiveContactsAccess();
    if (!access) return <div className="p-6">Unauthorized.</div>;
    const locationId = access.locationId;
    const contactVisibilityWhere = buildContactVisibilityWhere(access, 'location');

    const company = await db.company.findFirst({
        where: {
            id,
            locationId,
        },
        include: {
            propertyRoles: {
                where: { property: { locationId } },
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
                where: { contact: contactVisibilityWhere },
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
                    lastSyncAt: true,
                    isActive: true,
                },
                orderBy: { createdAt: "desc" },
            },
            _count: { select: { feeds: true } },
        },
    });

    if (!company) {
        notFound();
    }

    const safeWebsite = safeCompanyWebsite(company.website);

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="ghost" asChild>
                    <Link href="/admin/companies">
                        <ArrowLeft aria-hidden="true" className="h-4 w-4 mr-2" />
                        Back to Companies
                    </Link>
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{company.type || "Company"}</Badge>
                    <DeleteCompanyDialog
                        triggerVariant="button"
                        company={{
                            id: company.id,
                            name: company.name,
                            propertyRoleCount: company.propertyRoles.length,
                            contactRoleCount: company.contactRoles.length,
                            feedCount: company._count.feeds,
                        }}
                        redirectTo="/admin/companies"
                    />
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                        <Building2 aria-hidden="true" className="h-5 w-5 text-slate-600" />
                        {company.name}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.email ? (
                        <div className="flex items-center gap-2">
                            <Mail aria-hidden="true" className="h-4 w-4 text-slate-500" />
                            <span className="break-all">{company.email}</span>
                        </div>
                    ) : null}
                    {company.phone ? (
                        <div className="flex items-center gap-2">
                            <Phone aria-hidden="true" className="h-4 w-4 text-slate-500" />
                            <span>{company.phone}</span>
                        </div>
                    ) : null}
                    {company.website ? (
                        <div className="flex items-center gap-2">
                            <Globe aria-hidden="true" className="h-4 w-4 text-slate-500" />
                            {safeWebsite ? (
                                <a
                                    href={safeWebsite}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline break-all"
                                >
                                    {company.website}
                                </a>
                            ) : <span className="break-all">{company.website}</span>}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <h2 className="text-base font-semibold leading-none tracking-tight">XML Feeds</h2>
                </CardHeader>
                <CardContent>
                    <FeedManager companyId={company.id} initialFeeds={company.feeds} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <h2 className="text-base font-semibold leading-none tracking-tight">Property Relations</h2>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.propertyRoles.length === 0 ? (
                        <div className="text-muted-foreground">No property relations linked.</div>
                    ) : (
                        <ul className="space-y-2">
                            {company.propertyRoles.map((role) => (
                                <li key={role.id} className="flex items-center justify-between gap-3 rounded border p-2">
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
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <h2 className="text-base font-semibold leading-none tracking-tight">Contact Relations</h2>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {company.contactRoles.length === 0 ? (
                        <div className="text-muted-foreground">No contact relations linked.</div>
                    ) : (
                        <ul className="space-y-2">
                            {company.contactRoles.map((role) => (
                                <li key={role.id} className="rounded border p-2 space-y-1">
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
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
