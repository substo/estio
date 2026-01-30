"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebouncedCallback } from "use-debounce";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface ProjectFiltersProps {
    developers?: string[];
}

export function ProjectFilters({ developers = [] }: ProjectFiltersProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const [query, setQuery] = useState(searchParams.get("q") || "");
    const [developer, setDeveloper] = useState(searchParams.get("developer") || "");
    const [hasProperties, setHasProperties] = useState(searchParams.get("hasProperties") === "true");

    const [developerOpen, setDeveloperOpen] = useState(false);

    // Sync local state with URL params
    useEffect(() => {
        setQuery(searchParams.get("q") || "");
        setDeveloper(searchParams.get("developer") || "");
        setHasProperties(searchParams.get("hasProperties") === "true");
    }, [searchParams]);

    const updateFilter = (name: string, value: string | boolean | null) => {
        const params = new URLSearchParams(searchParams.toString());

        if (value === null || value === "" || value === false) {
            params.delete(name);
        } else {
            params.set(name, String(value));
        }

        // Reset pagination if it exists
        params.delete("skip");
        params.delete("page");

        router.push(`${pathname}?${params.toString()}`);
    };

    const debouncedUpdate = useDebouncedCallback((name: string, value: string) => {
        updateFilter(name, value);
    }, 500);

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);
        debouncedUpdate("q", val);
    };

    const handleDeveloperSelect = (val: string) => {
        const newValue = val === developer ? "" : val;
        setDeveloper(newValue);
        updateFilter("developer", newValue);
        setDeveloperOpen(false);
    };

    const handleHasPropertiesChange = (checked: boolean) => {
        setHasProperties(checked);
        updateFilter("hasProperties", checked);
    };

    const clearFilters = () => {
        setQuery("");
        setDeveloper("");
        setHasProperties(false);
        router.push(pathname);
    };

    const hasActiveFilters = query || developer || hasProperties;

    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border shadow-sm mb-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-2">
                    <Label htmlFor="search-projects">Search</Label>
                    <Input
                        id="search-projects"
                        placeholder="Project name or location..."
                        value={query}
                        onChange={handleQueryChange}
                    />
                </div>

                <div className="space-y-2">
                    <Label>Developer</Label>
                    <Popover open={developerOpen} onOpenChange={setDeveloperOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={developerOpen}
                                className="w-full justify-between"
                            >
                                {developer
                                    ? developers.find((d) => d === developer) || developer
                                    : "Select developer..."}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0">
                            <Command>
                                <CommandInput placeholder="Search developer..." />
                                <CommandList>
                                    <CommandEmpty>No developer found.</CommandEmpty>
                                    <CommandGroup>
                                        <CommandItem
                                            value="all_developers_reset_option"
                                            onSelect={() => handleDeveloperSelect("")}
                                            className="cursor-pointer data-[disabled]:pointer-events-auto data-[disabled]:opacity-100"
                                        >
                                            <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    !developer ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            Any Developer
                                        </CommandItem>
                                        {developers.map((d) => (
                                            <CommandItem
                                                key={d}
                                                value={d} // Revert to original value (cmdk handles lowercasing)
                                                onSelect={() => handleDeveloperSelect(d)}
                                                className="cursor-pointer data-[disabled]:pointer-events-auto data-[disabled]:opacity-100"
                                            >
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        developer === d ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                {d}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="space-y-2 pb-2">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="has-properties"
                            checked={hasProperties}
                            onCheckedChange={handleHasPropertiesChange}
                        />
                        <Label htmlFor="has-properties">Has Linked Properties</Label>
                    </div>
                </div>

                <div className="md:text-right">
                    {hasActiveFilters && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearFilters}
                            className="text-gray-500 hover:text-gray-700"
                        >
                            <X className="h-4 w-4 mr-2" />
                            Clear Filters
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
