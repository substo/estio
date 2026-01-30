'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect } from "react";
import { SearchableSelect } from "./searchable-select";
import { AddCompanyDialog } from "./add-company-dialog";
import { getCompaniesForSelect } from "../../contacts/fetch-helpers";
import { Project } from "@prisma/client";

// Common features for projects - can be moved to constants
const PROJECT_FEATURES = [
    { key: "pool", label: "Swimming Pool" },
    { key: "gym", label: "Gym" },
    { key: "spa", label: "Spa" },
    { key: "parking", label: "Parking" },
    { key: "security", label: "24/7 Security" },
    { key: "concierge", label: "Concierge" },
    { key: "garden", label: "Landscaped Garden" },
    { key: "elevator", label: "Elevator" },
] as const;


export default function ProjectForm({ project, locationId }: { project?: Project, locationId: string }) {
    const [developers, setDevelopers] = useState<{ id: string; name: string }[]>([]);
    const [selectedDeveloperId, setSelectedDeveloperId] = useState<string>("");

    // If editing, try to find the developer in the list by name match?
    // Since `project.developer` is a string, we might not have the ID.
    // However, the `SearchableSelect` visualizes based on ID.
    // We will fetch companies and see if any match the name.

    useEffect(() => {
        getCompaniesForSelect(locationId, 'Developer').then((devs) => {
            const mappedDevs = devs.map(c => ({ id: c.id, name: c.name }));
            setDevelopers(mappedDevs);

            if (project?.developer) {
                const match = mappedDevs.find(d => d.name === project.developer);
                if (match) {
                    setSelectedDeveloperId(match.id);
                }
            }
        });
    }, [locationId, project]);

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="ghlProjectId" value={project?.ghlProjectId || ""} />

            {/* The developer string field is populated by the selected company name */}
            <input
                type="hidden"
                name="developer"
                value={developers.find(d => d.id === selectedDeveloperId)?.name || project?.developer || ""}
            />

            <Tabs defaultValue="details" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-1 pt-1">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="specs">Specs</TabsTrigger>
                        <TabsTrigger value="stakeholders">Stakeholders</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto px-1">
                    <TabsContent value="details" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="name">Project Name</Label>
                                <Input id="name" name="name" defaultValue={project?.name} required placeholder="e.g. Sunrise Apartments" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="projectLocation">Location / Area</Label>
                                <Input id="projectLocation" name="projectLocation" defaultValue={project?.projectLocation || ""} placeholder="e.g. Limassol Marina" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="website">Website</Label>
                                <Input id="website" name="website" defaultValue={project?.website || ""} placeholder="https://" />
                            </div>

                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea id="description" name="description" defaultValue={project?.description || ""} className="min-h-[100px]" />
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="specs" className="space-y-4 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="completionDate">Completion Date</Label>
                                <Input
                                    type="date"
                                    id="completionDate"
                                    name="completionDate"
                                    defaultValue={project?.completionDate ? new Date(project.completionDate).toISOString().split('T')[0] : ""}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="totalUnits">Total Units</Label>
                                <Input type="number" id="totalUnits" name="totalUnits" defaultValue={project?.totalUnits?.toString()} />
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t">
                            <Label className="text-lg font-semibold">Features & Amenities</Label>
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                {PROJECT_FEATURES.map((feature) => (
                                    <div key={feature.key} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`feature-${feature.key}`}
                                            name="features"
                                            value={feature.key}
                                            defaultChecked={project?.features?.includes(feature.key)}
                                        />
                                        <Label htmlFor={`feature-${feature.key}`} className="text-sm font-normal cursor-pointer">
                                            {feature.label}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="stakeholders" className="space-y-6 py-4 data-[state=inactive]:hidden" forceMount={true}>
                        {/* Developer Section */}
                        <div className="space-y-2 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
                            <Label className="text-lg font-semibold text-gray-700 dark:text-gray-300">Developer Details</Label>
                            <div className="space-y-2">
                                <Label>Select Developer</Label>
                                <div className="flex gap-2">
                                    <SearchableSelect
                                        name="developerIdSelect" // Not directly used in action, we use the hidden 'developer' input
                                        value={selectedDeveloperId}
                                        onChange={setSelectedDeveloperId}
                                        options={developers.map(c => ({ value: c.id, label: c.name }))}
                                        placeholder="Select Developer..."
                                        searchPlaceholder="Search companies..."
                                        className="flex-1"
                                    />
                                    <AddCompanyDialog
                                        locationId={locationId}
                                        type="Developer"
                                        onSuccess={(newCompany) => {
                                            setDevelopers(prev => [...prev, newCompany].sort((a, b) => a.name.localeCompare(b.name)));
                                            setSelectedDeveloperId(newCompany.id);
                                        }}
                                    />
                                </div>
                                <p className="text-xs text-gray-500">
                                    Selecting a developer will link the company name to this project.
                                </p>
                            </div>
                        </div>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
