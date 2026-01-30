'use client';

import { GHLProperty } from '@/lib/ghl/types';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../ui/table';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Edit, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useState, useTransition } from 'react';
import { PropertyEditDialog } from './property-edit-dialog';
import { deletePropertyAction } from '@/app/(main)/admin/properties/actions';
import { toast } from 'sonner';

import { Project } from '@prisma/client';

interface PropertyTableProps {
    data: GHLProperty[];
    total: number;
    limit: number;
    skip: number;
    locationId: string;
    editingProperty?: any;
    // New props for form options
    contactsData?: { id: string; name: string }[];
    developersData?: { id: string; name: string }[];
    managementCompaniesData?: { id: string; name: string }[];
    projectsData?: Project[];
    domain?: string | null;
}

export function PropertyTable({
    data,
    total,
    limit,
    skip,
    locationId,
    editingProperty,
    contactsData,
    developersData,
    managementCompaniesData,
    projectsData,
    domain
}: PropertyTableProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [propertyToDelete, setPropertyToDelete] = useState<string | null>(null);

    // We can derive the open state from the presence of editingProperty or the URL param
    // But since editingProperty is passed from server, we can just use that.
    // However, for client-side navigation (clicking edit), we want immediate feedback.
    // So we can check URL param too.
    const isEditOpen = !!searchParams.get('propertyId');

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(skip / limit) + 1;

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('skip', ((newPage - 1) * limit).toString());
        router.push(`?${params.toString()}`);
    };

    const handleEdit = (id: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('propertyId', id);
        router.push(`?${params.toString()}`);
    };

    const handleClose = (open: boolean) => {
        if (!open) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete('propertyId');
            router.push(`?${params.toString()}`);
        }
    };

    const handleDeleteClick = (id: string) => {
        setPropertyToDelete(id);
    };

    const handleConfirmDelete = async () => {
        if (!propertyToDelete) return;

        startTransition(async () => {
            try {
                await deletePropertyAction(propertyToDelete, locationId);
                toast.success('Property deleted successfully');
                setPropertyToDelete(null);
                router.refresh(); // Refresh to update the list
            } catch (error) {
                console.error('Failed to delete property:', error);
                toast.error('Failed to delete property. Please try again.');
            }
        });
    };

    const formatCurrency = (amount: number | undefined, currency: string) => {
        if (!amount) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'EUR',
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Active': return 'bg-green-100 text-green-800';
            case 'Under Offer': return 'bg-yellow-100 text-yellow-800';
            case 'Sold': return 'bg-blue-100 text-blue-800';
            case 'Rented': return 'bg-purple-100 text-purple-800';
            case 'Withdrawn': return 'bg-gray-100 text-gray-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (data.length === 0) {
        return (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">No properties found</h3>
                <p className="mt-1 text-sm text-gray-500">Try adjusting your filters or search query.</p>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4">
                <div className="rounded-md border bg-white">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="hidden xl:table-cell">Reference</TableHead>
                                <TableHead>Title</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="hidden lg:table-cell">Publication</TableHead>
                                <TableHead className="hidden lg:table-cell">Goal</TableHead>
                                <TableHead className="hidden md:table-cell">District</TableHead>
                                <TableHead>Price</TableHead>
                                <TableHead className="hidden sm:table-cell">Beds/Baths</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map((item) => (
                                <TableRow
                                    key={item.id}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => router.push(`/admin/properties/${item.id}/view`)}
                                >
                                    <TableCell className="font-medium hidden xl:table-cell">
                                        {item.properties.property_reference}
                                    </TableCell>
                                    <TableCell>
                                        <div className="max-w-[150px] sm:max-w-[200px] truncate" title={item.properties.title}>
                                            {item.properties.title}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className={getStatusColor(item.properties.status)}>
                                            {item.properties.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">
                                        <Badge variant="outline">
                                            {item.properties.publication_status || 'PUBLISHED'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">{item.properties.goal}</TableCell>
                                    <TableCell className="hidden md:table-cell">{item.properties.location}</TableCell>
                                    <TableCell>
                                        {formatCurrency(item.properties.price, item.properties.currency)}
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                        {item.properties.bedrooms || 0} bd / {item.properties.bathrooms || 0} ba
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {domain && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="View on Public Site"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(`http://${domain}/properties/${item.properties.property_reference}`, '_blank');
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4 hidden" /> {/* Hack to keep layout same if needed or just use icon */}
                                                    {/* Actually let's use a Globe or Eye icon */}
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="12" r="10" /><line x1="2" x2="22" y1="12" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEdit(item.id);
                                                }}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteClick(item.id);
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-2">
                        <div className="text-sm text-gray-500">
                            Showing {skip + 1} to {Math.min(skip + limit, total)} of {total} results
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage <= 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Previous
                            </Button>
                            <div className="text-sm font-medium">
                                Page {currentPage} of {totalPages}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage >= totalPages}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <PropertyEditDialog
                isOpen={isEditOpen}
                onOpenChange={handleClose}
                property={editingProperty}
                locationId={locationId}
                contactsData={contactsData}
                developersData={developersData}
                managementCompaniesData={managementCompaniesData}
                projectsData={projectsData}
                onSuccess={(savedProperty: any) => {
                    if (savedProperty?.id) {
                        router.push(`/admin/properties/${savedProperty.id}/view`);
                    } else {
                        handleClose(false);
                    }
                }}
            />

            <AlertDialog open={!!propertyToDelete} onOpenChange={(open: boolean) => !open && setPropertyToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the property and remove all associations with Contacts and Companies. The actual contacts and companies will NOT be deleted, only their connection to this property.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                            disabled={isPending}
                        >
                            {isPending ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
