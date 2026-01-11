"use client";

import { Input } from "@/components/ui/input";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useDebouncedCallback } from "use-debounce";
import { cn } from "@/lib/utils";

const COMPANY_TYPES = [
    { label: "All Types", value: "all" },
    { label: "Management", value: "Management" },
    { label: "Developer", value: "Developer" },
    { label: "Agency", value: "Agency" },
    { label: "Other", value: "Other" },
];

export function CompanyFilters() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const currentType = searchParams.get("type") || "all";

    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        if (term) {
            params.set("q", term);
        } else {
            params.delete("q");
        }
        router.replace(`${pathname}?${params.toString()}`);
    }, 300);

    const handleTypeChange = (value: string) => {
        const params = new URLSearchParams(searchParams);
        if (value && value !== 'all') {
            params.set("type", value);
        } else {
            params.delete("type");
        }
        router.replace(`${pathname}?${params.toString()}`);
    };

    return (
        <div className="flex gap-4 items-center">
            <Input
                placeholder="Search companies..."
                defaultValue={searchParams.get("q")?.toString()}
                onChange={(e) => handleSearch(e.target.value)}
                className="max-w-xs"
            />

            <div className="bg-gray-100 p-1 rounded-lg flex items-center shrink-0">
                {COMPANY_TYPES.map((type) => (
                    <button
                        key={type.value}
                        onClick={() => handleTypeChange(type.value)}
                        className={cn(
                            "px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all",
                            currentType === type.value
                                ? "bg-white shadow-sm text-black"
                                : "text-gray-500 hover:text-gray-900"
                        )}
                    >
                        {type.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
