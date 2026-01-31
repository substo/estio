"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Link as LinkIcon, Link2, CheckCircle } from "lucide-react";
import { GoogleSyncManager } from "./google-sync-manager";
import { EditContactDialog } from "./edit-contact-dialog";
import { ContactData } from "./contact-form";

interface ContactRowProps {
    contact: ContactData & {
        createdAt: Date;
        propertyRoles: any[];
        companyRoles: any[];
        heatScore: number;
        status: string;
        googleContactId?: string | null;
        error?: string | null;
    };
    leadSources: string[];
}

export function ContactRow({ contact, leadSources }: ContactRowProps) {
    const router = useRouter();
    const [managerOpen, setManagerOpen] = useState(false);

    const handleRowClick = (e: React.MouseEvent) => {
        // Prevent navigation if clicking buttons or interactions
        if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a') || (e.target as HTMLElement).closest('[role="dialog"]')) {
            return;
        }
        router.push(`/admin/contacts/${contact.id}/view`);
    };

    const isLinked = !!contact.googleContactId;
    const hasError = !!contact.error;

    return (
        <>
            <tr onClick={handleRowClick} className="border-t hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors">


                <td className="p-4">{format(new Date(contact.createdAt), "dd/MM/yyyy")}</td>
                <td className="p-4 font-medium">{contact.name || "Unknown"}</td>
                <td className="p-4">
                    <div className="flex flex-col">
                        <span>{contact.email}</span>
                        <span className="text-xs text-gray-500">{contact.phone}</span>
                    </div>
                </td>
                <td className="p-4">
                    <div className="flex flex-col gap-1">
                        {(contact.propertyRoles.length === 0 && contact.companyRoles.length === 0) ? (
                            <span className="text-gray-500 italic">General Inquiry</span>
                        ) : (
                            <>
                                {contact.propertyRoles.map((r, i) => (
                                    <span key={`prop-${i}`} className="text-xs">
                                        <span className="font-semibold capitalize">{r.role}:</span> {r.property.title}
                                    </span>
                                ))}
                                {contact.companyRoles.map((r, i) => (
                                    <span key={`comp-${i}`} className="text-xs">
                                        <span className="font-semibold capitalize">{r.role}:</span> {r.company.name}
                                    </span>
                                ))}
                            </>
                        )}
                    </div>
                </td>
                <td className="p-4">
                    <span className={`font-bold ${contact.heatScore > 50 ? 'text-red-600' : contact.heatScore > 20 ? 'text-orange-500' : 'text-gray-500'}`}>
                        {contact.heatScore}
                    </span>
                </td>
                <td className="p-4">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${contact.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {contact.status}
                        </span>

                        {/* Google Sync Status Icon */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`h-6 w-6 ${hasError
                                ? "text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
                                : isLinked
                                    ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                }`}
                            onClick={(e) => { e.stopPropagation(); setManagerOpen(true); }}
                            title={hasError ? contact.error! : isLinked ? "Linked to Google" : "Not Linked"}
                        >
                            {hasError ? (
                                <AlertTriangle className="h-4 w-4" />
                            ) : isLinked ? (
                                <LinkIcon className="h-4 w-4" />
                            ) : (
                                <Link2 className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </td>
                <td className="p-4" onClick={(e) => e.stopPropagation()} >
                    {/* Explicit stop propagation for the action cell */}
                    <EditContactDialog contact={contact} leadSources={leadSources} />
                </td>
            </tr>
            {/* Render Manager outside of tr */}
            {managerOpen && (
                <GoogleSyncManager
                    contact={contact}
                    open={managerOpen}
                    onOpenChange={setManagerOpen}
                />
            )}
        </>
    );
}
