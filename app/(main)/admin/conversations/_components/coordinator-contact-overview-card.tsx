import dynamic from "next/dynamic";
import Link from "next/link";
import { Home, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DEFAULT_CONTACT_TYPE } from "../../contacts/_components/contact-types";
import type { ContactIdentityPatch } from "../../contacts/_components/contact-form";
import { GroupMembersList } from "./group-members-list";
import { hasFullContactContext } from "./conversation-workspace-ui-actions";

const EditContactDialog = dynamic(
    () => import("../../contacts/_components/edit-contact-dialog").then((mod) => mod.EditContactDialog),
    {
        loading: () => <div className="h-10 rounded-md bg-slate-100 animate-pulse" />,
    }
);

interface CoordinatorContactOverviewCardProps {
    conversationId: string;
    conversationContactName?: string | null;
    conversationStatus?: string | null;
    contactContext: any;
    loadingContext: boolean;
    hidden: boolean;
    onContactSaved?: (patch: ContactIdentityPatch) => void;
    onContactMerged?: (targetContactId: string, targetConversationId?: string | null) => void;
}

function normalizeContactValue(value: unknown): string {
    return String(value || "").trim().toLowerCase();
}

function isMeaningfulRequirementValue(value: unknown): boolean {
    const raw = String(value || "").trim();
    if (!raw) return false;
    return !raw.toLowerCase().includes("any");
}

function formatRoleLabel(value: unknown): string {
    const cleaned = String(value || "").trim().replace(/[_-]+/g, " ");
    if (!cleaned) return "Role";
    return cleaned
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(" ");
}

function getBriefRequirementItems(contact: any): Array<{ label: string; value: string }> {
    if (!contact) return [];

    const items: Array<{ label: string; value: string }> = [];
    const district = String(contact.requirementDistrict || "").trim();
    const bedrooms = String(contact.requirementBedrooms || "").trim();
    const condition = String(contact.requirementCondition || "").trim();
    const minPrice = String(contact.requirementMinPrice || "").trim();
    const maxPrice = String(contact.requirementMaxPrice || "").trim();
    const propertyTypes = (Array.isArray(contact.requirementPropertyTypes) ? contact.requirementPropertyTypes : [])
        .map((value: any) => String(value || "").trim())
        .filter(Boolean);
    const locations = (Array.isArray(contact.requirementPropertyLocations) ? contact.requirementPropertyLocations : [])
        .map((value: any) => String(value || "").trim())
        .filter(Boolean);

    if (isMeaningfulRequirementValue(district)) items.push({ label: "District", value: district });
    if (isMeaningfulRequirementValue(bedrooms)) items.push({ label: "Beds", value: bedrooms });
    if (isMeaningfulRequirementValue(condition)) items.push({ label: "Condition", value: condition });

    const hasMin = isMeaningfulRequirementValue(minPrice);
    const hasMax = isMeaningfulRequirementValue(maxPrice);
    if (hasMin || hasMax) {
        items.push({
            label: "Budget",
            value: `${hasMin ? minPrice : "Min open"} - ${hasMax ? maxPrice : "Max open"}`,
        });
    }

    if (propertyTypes.length > 0) {
        items.push({
            label: "Types",
            value: propertyTypes.slice(0, 3).join(", "),
        });
    }
    if (locations.length > 0) {
        items.push({
            label: "Areas",
            value: locations.slice(0, 3).join(", "),
        });
    }

    return items;
}

export function CoordinatorContactOverviewCard({
    conversationId,
    conversationContactName,
    conversationStatus,
    contactContext,
    loadingContext,
    hidden,
    onContactSaved,
    onContactMerged,
}: CoordinatorContactOverviewCardProps) {
    const canEditContact = hasFullContactContext(contactContext);

    return (
        <div className={cn(hidden ? 'hidden' : 'block')}>
            {(contactContext?.contact?.contactType === 'WhatsAppGroup' || contactContext?.contact?.phone?.includes('@g.us')) ? (
                <GroupMembersList conversationId={conversationId} />
            ) : (
                <Card className="shadow-none border-border/50">
                    <CardHeader className="p-3 pb-1.5">
                        <div className="flex justify-between items-center pr-4">
                            <CardTitle className="text-xs font-semibold">Details</CardTitle>
                            {canEditContact && (
                                <EditContactDialog
                                    contact={contactContext.contact}
                                    leadSources={contactContext.leadSources || []}
                                    onContactSaved={onContactSaved}
                                    onMergeSuccess={onContactMerged}
                                    skipRouterRefresh
                                />
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 text-sm space-y-2">
                        {contactContext?.contact ? (
                            <>
                                <div className="flex flex-col gap-0.5">
                                    <div className="font-medium text-sm text-primary hover:underline cursor-pointer">
                                        {canEditContact ? (
                                            <EditContactDialog
                                                contact={contactContext.contact}
                                                leadSources={contactContext.leadSources || []}
                                                trigger={<span>{contactContext.contact.name || "Unnamed Contact"}</span>}
                                                onContactSaved={onContactSaved}
                                                onMergeSuccess={onContactMerged}
                                                skipRouterRefresh
                                            />
                                        ) : (
                                            <span>{contactContext.contact.name || "Unnamed Contact"}</span>
                                        )}
                                    </div>
                                    <div className="text-muted-foreground text-[11px] flex flex-col gap-0.5">
                                        {contactContext.contact.email && (
                                            <div className="flex items-center gap-2">
                                                <span className="w-12 opacity-70">Email:</span>
                                                <span className="select-all text-foreground break-all">{contactContext.contact.email}</span>
                                            </div>
                                        )}
                                        {contactContext.contact.phone && (
                                            <div className="flex items-center gap-2">
                                                <span className="w-12 opacity-70">Phone:</span>
                                                <span className="select-all text-foreground break-all">{contactContext.contact.phone}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-1.5 text-xs">
                                    <div className="bg-secondary/50 p-1.5 rounded border border-secondary">
                                        <span className="text-muted-foreground block text-[10px] mb-0.5">Status</span>
                                        <span className="font-medium">{contactContext.contact.leadStage || "Unassigned"}</span>
                                    </div>
                                    <div className="bg-secondary/50 p-1.5 rounded border border-secondary">
                                        <span className="text-muted-foreground block text-[10px] mb-0.5">Type</span>
                                        <span className="font-medium">{contactContext.contact.contactType || "Lead"}</span>
                                    </div>
                                </div>

                                {(() => {
                                    const contact = contactContext.contact;
                                    const normalizedType = normalizeContactValue(
                                        contact.normalizedContactType || contact.contactType || DEFAULT_CONTACT_TYPE
                                    );

                                    const propertyRoles = (Array.isArray(contact.propertyRoles) ? contact.propertyRoles : [])
                                        .map((role: any) => ({
                                            ...role,
                                            normalizedRole: normalizeContactValue(role.normalizedRole || role.role),
                                        }))
                                        .filter((role: any) => !!role?.property?.id);

                                    const companyRoles = (Array.isArray(contact.companyRoles) ? contact.companyRoles : [])
                                        .map((role: any) => ({
                                            ...role,
                                            normalizedRole: normalizeContactValue(role.normalizedRole || role.role),
                                        }))
                                        .filter((role: any) => !!role?.company?.id);

                                    const interestedProperties = (Array.isArray(contact.interestedProperties) ? contact.interestedProperties : [])
                                        .filter((property: any) => !!property?.id);

                                    const inspectedProperties = (Array.isArray(contact.inspectedProperties) ? contact.inspectedProperties : [])
                                        .filter((property: any) => !!property?.id);

                                    const briefRequirementItems = getBriefRequirementItems(contact);
                                    const isLeadLike = normalizedType === "lead" || normalizedType === "contact";
                                    const isOwnerOrTenant = normalizedType === "owner" || normalizedType === "tenant";
                                    const isAgentPartnerAssociate = normalizedType === "agent" || normalizedType === "partner" || normalizedType === "associate";
                                    const isMaintenance = normalizedType === "maintenance";
                                    const isWhatsAppGroup = normalizedType === "whatsappgroup";

                                    let showCompanyRelations = false;
                                    let showPropertyAssociations = false;
                                    let showInterested = false;
                                    let showInspected = false;
                                    let showRequirements = false;

                                    if (isAgentPartnerAssociate) {
                                        showCompanyRelations = companyRoles.length > 0;
                                    } else if (isMaintenance) {
                                        showCompanyRelations = companyRoles.length > 0;
                                        showPropertyAssociations = companyRoles.length === 0 && propertyRoles.length > 0;
                                    } else if (isOwnerOrTenant) {
                                        showPropertyAssociations = propertyRoles.length > 0;
                                    } else if (isLeadLike) {
                                        showInterested = interestedProperties.length > 0;
                                        showInspected = inspectedProperties.length > 0;
                                        showRequirements = briefRequirementItems.length > 0;
                                        if (normalizedType === "contact") {
                                            showCompanyRelations = companyRoles.length > 0;
                                            showPropertyAssociations = propertyRoles.length > 0;
                                        }
                                    } else if (!isWhatsAppGroup) {
                                        showCompanyRelations = companyRoles.length > 0;
                                        showPropertyAssociations = propertyRoles.length > 0;
                                    }

                                    return (
                                        <>
                                            {showCompanyRelations && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Company Relations</span>
                                                    <div className="space-y-1">
                                                        {companyRoles.map((role: any) => (
                                                            <div key={role.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-emerald-50/50 rounded border border-emerald-100/60 text-foreground">
                                                                <Users className="w-3 h-3 text-emerald-600" />
                                                                <Link
                                                                    href={`/admin/companies/${encodeURIComponent(role.company.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={role.company.name}
                                                                >
                                                                    {role.company.name}
                                                                </Link>
                                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                                    {formatRoleLabel(role.role)}
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showPropertyAssociations && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Property Associations</span>
                                                    <div className="space-y-1">
                                                        {propertyRoles.map((role: any) => (
                                                            <div key={role.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-blue-50/50 rounded border border-blue-100/60 text-foreground">
                                                                <Home className="w-3 h-3 text-blue-600" />
                                                                <Link
                                                                    href={`/admin/properties/${encodeURIComponent(role.property.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={role.property.title}
                                                                >
                                                                    {role.property.reference || role.property.title}
                                                                </Link>
                                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                                    {formatRoleLabel(role.role)}
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showInterested && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Interested</span>
                                                    <div className="space-y-1">
                                                        {interestedProperties.map((property: any) => (
                                                            <div key={property.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-blue-50/50 rounded border border-blue-100/60 text-foreground">
                                                                <Home className="w-3 h-3 text-blue-600" />
                                                                <Link
                                                                    href={`/admin/properties/${encodeURIComponent(property.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={property.title}
                                                                >
                                                                    {property.reference || property.title}
                                                                </Link>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showInspected && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Inspected</span>
                                                    <div className="space-y-1">
                                                        {inspectedProperties.map((property: any) => (
                                                            <div key={property.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-amber-50/60 rounded border border-amber-100/80 text-foreground">
                                                                <Home className="w-3 h-3 text-amber-600" />
                                                                <Link
                                                                    href={`/admin/properties/${encodeURIComponent(property.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={property.title}
                                                                >
                                                                    {property.reference || property.title}
                                                                </Link>
                                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                                    Viewed
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showRequirements && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Requirements</span>
                                                    <div className="flex flex-wrap gap-1">
                                                        {briefRequirementItems.map((item) => (
                                                            <Badge
                                                                key={`${item.label}-${item.value}`}
                                                                variant="secondary"
                                                                className="text-[9px] h-5 px-1.5 font-normal bg-secondary/60"
                                                            >
                                                                {item.label}: {item.value}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                    {contact.requirementSummary && (
                                                        <p className="mt-1.5 text-[11px] leading-snug text-slate-600 whitespace-pre-wrap">
                                                            {contact.requirementSummary}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}

                            </>
                        ) : (
                            // Fallback if context not loaded yet
                            <div className="flex flex-col gap-2 opacity-50">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Name:</span>
                                    <span>{conversationContactName}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span>{conversationStatus}</span>
                                </div>
                                {loadingContext && <div className="text-xs text-center text-primary mt-2">Loading full details...</div>}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
