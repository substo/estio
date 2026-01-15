'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, User, Phone, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

export interface ContactOption {
    id: string;
    name: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone: string | null;
    email: string | null;
}

interface ContactSearchSelectProps {
    contacts: ContactOption[];
    value?: string | null;
    onChange: (contactId: string | null) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    allowSkip?: boolean;
}

/**
 * Searchable contact select with rich display
 * Searches by: name, firstName, lastName, phone, email
 */
export function ContactSearchSelect({
    contacts,
    value,
    onChange,
    placeholder = 'Select contact...',
    disabled = false,
    className,
    allowSkip = true,
}: ContactSearchSelectProps) {
    const [open, setOpen] = React.useState(false);

    const selectedContact = contacts.find(c => c.id === value);

    // Build searchable string for each contact
    const getSearchString = (contact: ContactOption) => {
        const parts = [
            contact.name,
            contact.firstName,
            contact.lastName,
            contact.phone,
            contact.email,
        ].filter(Boolean);
        return parts.join(' ').toLowerCase();
    };

    const getDisplayName = (contact: ContactOption) => {
        if (contact.name) return contact.name;
        if (contact.firstName || contact.lastName) {
            return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
        }
        return contact.phone || contact.email || 'Unnamed Contact';
    };

    return (
        <div className={className}>
            <Popover open={open} onOpenChange={setOpen} modal={true}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        type="button"
                        aria-expanded={open}
                        className={cn(
                            "w-full justify-between font-normal h-auto min-h-10 py-2",
                            !value && "text-muted-foreground"
                        )}
                        disabled={disabled}
                    >
                        {selectedContact ? (
                            <div className="flex flex-col items-start text-left">
                                <span className="font-medium">{getDisplayName(selectedContact)}</span>
                                <span className="text-xs text-muted-foreground">
                                    {selectedContact.phone || selectedContact.email}
                                </span>
                            </div>
                        ) : value === null ? (
                            <span className="text-gray-400">— Skip —</span>
                        ) : (
                            placeholder
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                        <CommandInput placeholder="Search by name, phone, or email..." />
                        <CommandList>
                            <CommandEmpty>No contact found.</CommandEmpty>
                            <CommandGroup>
                                {allowSkip && (
                                    <CommandItem
                                        value="__skip__"
                                        onSelect={() => {
                                            onChange(null);
                                            setOpen(false);
                                        }}
                                        className="cursor-pointer"
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                value === null ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        <span className="text-gray-400">— Skip this sender —</span>
                                    </CommandItem>
                                )}
                                {contacts.map((contact) => (
                                    <CommandItem
                                        key={contact.id}
                                        value={`${getSearchString(contact)}___${contact.id}`}
                                        onSelect={() => {
                                            onChange(contact.id === value ? null : contact.id);
                                            setOpen(false);
                                        }}
                                        className="cursor-pointer data-[disabled]:pointer-events-auto data-[disabled]:opacity-100"
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4 shrink-0",
                                                value === contact.id ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <User className="h-3 w-3 text-gray-400 shrink-0" />
                                                <span className="font-medium truncate text-foreground">
                                                    {getDisplayName(contact)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-gray-500">
                                                {contact.phone && (
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="h-3 w-3" />
                                                        {contact.phone}
                                                    </span>
                                                )}
                                                {contact.email && (
                                                    <span className="flex items-center gap-1 truncate">
                                                        <Mail className="h-3 w-3" />
                                                        {contact.email}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
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
