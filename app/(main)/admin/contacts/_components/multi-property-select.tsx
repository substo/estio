'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';

interface Option {
    value: string;
    label: string;
}

interface MultiSelectProps {
    options: Option[];
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    name?: string;
    disabled?: boolean;
    className?: string;
}

export function MultiPropertySelect({
    options,
    value = [],
    onChange,
    placeholder = 'Select properties...',
    searchPlaceholder = 'Search properties...',
    emptyMessage = 'No properties found.',
    name,
    disabled = false,
    className,
}: MultiSelectProps) {
    const [open, setOpen] = React.useState(false);

    const handleSelect = (optionValue: string) => {
        if (value.includes(optionValue)) {
            onChange(value.filter(v => v !== optionValue));
        } else {
            onChange([...value, optionValue]);
        }
    };

    const handleRemove = (optionValue: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onChange(value.filter(v => v !== optionValue));
    };

    const selectedLabels = value.map(v => {
        const option = options.find(o => o.value === v);
        return option ? { value: v, label: option.label } : { value: v, label: v };
    });

    return (
        <div className={cn("space-y-2", className)}>
            {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}

            {/* Selected chips */}
            {selectedLabels.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {selectedLabels.map(item => (
                        <Badge
                            key={item.value}
                            variant="secondary"
                            className="gap-1 pr-1"
                        >
                            <span className="max-w-[150px] truncate">{item.label}</span>
                            <button
                                type="button"
                                onClick={(e) => handleRemove(item.value, e)}
                                className="hover:bg-muted rounded-sm p-0.5"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}

            <Popover open={open} onOpenChange={setOpen} modal={true}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        type="button"
                        aria-expanded={open}
                        className={cn(
                            "w-full justify-between font-normal",
                            value.length === 0 && "text-muted-foreground"
                        )}
                        disabled={disabled}
                    >
                        {value.length === 0
                            ? placeholder
                            : `${value.length} selected`}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                        <CommandInput placeholder={searchPlaceholder} />
                        <CommandList>
                            <CommandEmpty>{emptyMessage}</CommandEmpty>
                            <CommandGroup>
                                {options.map((option) => (
                                    <CommandItem
                                        key={option.value}
                                        value={`${option.label}___${option.value}`}
                                        onSelect={() => handleSelect(option.value)}
                                        className="cursor-pointer data-[disabled]:pointer-events-auto data-[disabled]:opacity-100"
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                value.includes(option.value) ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        {option.label}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
