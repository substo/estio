"use client";

import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash, GripVertical, Save, Link as LinkIcon, FileText, Folder, ChevronRight, ChevronDown, Plus } from "lucide-react";
import { saveNavigation } from "../actions";
import { toast } from "sonner";
import { SearchableSelect } from "../../../contacts/_components/searchable-select";
import { Switch } from "@/components/ui/switch";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverEvent,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DropAnimation,
    MeasuringStrategy,
    UniqueIdentifier,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from "@/lib/utils";

// --- Types ---

interface LinkItem {
    id: string;
    label: string;
    href: string;
    type: 'page' | 'custom' | 'category';
    children?: LinkItem[];
    isOpen?: boolean; // For UI state (collapsed/expanded)
}

interface PageOption {
    label: string;
    value: string;
}

// --- Sortable Item Component ---

function SortableLinkItem({
    link,
    index, // Index in the parent's children array or root array
    parentId, // ID of the parent category, or null if root
    availablePages,
    updateLink,
    removeLink,
    depth = 0
}: {
    link: LinkItem,
    index: number,
    parentId: string | null,
    availablePages: PageOption[],
    updateLink: (id: string, field: keyof LinkItem, value: any) => void,
    removeLink: (id: string) => void,
    depth?: number
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: link.id,
        data: {
            type: link.type,
            item: link,
            parentId: parentId,
            index: index,
            depth: depth
        }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    const getLinkType = (link: LinkItem) => {
        if (link.type) return link.type;
        return availablePages.some(p => p.value === link.href) ? 'page' : 'custom';
    };

    const linkType = getLinkType(link);
    const isPage = linkType === 'page';
    const isCategory = linkType === 'category';

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "group relative border rounded-lg bg-white transition-colors",
                isDragging ? "z-50 shadow-xl ring-2 ring-primary/20" : "hover:border-gray-300",
                depth > 0 ? "ml-8 mt-2 border-l-4 border-l-primary/20" : "mb-2"
            )}
        >
            <div className="flex gap-2 items-start p-3">
                <div
                    className="cursor-grab active:cursor-grabbing pt-2.5 text-gray-400 hover:text-gray-600 touch-none"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="w-4 h-4" />
                </div>

                <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                        {isCategory && (
                            <div
                                className="p-2 rounded bg-orange-50 text-orange-600 cursor-pointer hover:bg-orange-100 transition-colors"
                                onClick={() => updateLink(link.id, 'isOpen', !link.isOpen)}
                            >
                                {link.isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </div>
                        )}

                        <Input
                            value={link.label}
                            onChange={(e) => updateLink(link.id, 'label', e.target.value)}
                            placeholder={isCategory ? "Category Name" : "Label"}
                            className={cn(
                                "h-9 flex-1 font-medium",
                                isCategory && "text-orange-900 placeholder:text-orange-300"
                            )}
                        />

                        {!isCategory ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground bg-gray-50 border rounded px-2 h-9 min-w-fit">
                                <FileText className={cn("w-3 h-3 transition-colors", isPage ? "text-blue-500" : "text-gray-300")} />
                                <Switch
                                    checked={!isPage} // Checked = Custom
                                    onCheckedChange={(checked) => {
                                        const newType = checked ? 'custom' : 'page';
                                        updateLink(link.id, 'type', newType);
                                        if (newType === 'page' && !availablePages.some(p => p.value === link.href)) {
                                            updateLink(link.id, 'href', '');
                                        }
                                    }}
                                    className="scale-75 data-[state=checked]:bg-blue-500"
                                />
                                <LinkIcon className={cn("w-3 h-3 transition-colors", !isPage ? "text-blue-500" : "text-gray-300")} />
                            </div>
                        ) : (
                            <div className="flex items-center px-3 h-9 bg-orange-50 text-orange-600 text-xs font-semibold uppercase tracking-wider rounded border border-orange-100">
                                Folder
                            </div>
                        )}
                    </div>

                    {!isCategory && (
                        <div className="flex gap-2 items-center">
                            {isPage ? (
                                <SearchableSelect
                                    options={availablePages}
                                    value={link.href}
                                    onChange={(val) => {
                                        updateLink(link.id, 'href', val);
                                        if (link.label === "New Link" || link.label === "") {
                                            const p = availablePages.find(p => p.value === val);
                                            if (p) updateLink(link.id, 'label', p.label);
                                        }
                                    }}
                                    placeholder="Select a page..."
                                    searchPlaceholder="Search pages..."
                                    className="w-full"
                                />
                            ) : (
                                <Input
                                    value={link.href}
                                    onChange={(e) => updateLink(link.id, 'href', e.target.value)}
                                    placeholder="/slug or https://..."
                                    className="h-9 font-mono text-xs"
                                />
                            )}
                        </div>
                    )}
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLink(link.id)}
                    className="text-gray-400 hover:text-red-600 hover:bg-red-50"
                >
                    <Trash className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}

// --- Main Menu Builder Component ---

export function MenuBuilder({ type, initialLinks, availablePages = [] }: { type: 'nav' | 'footer' | 'legal' | 'social', initialLinks: any[], availablePages?: PageOption[] }) {
    const [links, setLinks] = useState<LinkItem[]>([]);
    const [saving, setSaving] = useState(false);
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

    // Initial hydration
    useEffect(() => {
        const hydrate = (items: any[]): LinkItem[] => {
            return items.map(item => ({
                ...item,
                id: item.id || `item-${Math.random().toString(36).substr(2, 9)}`,
                children: item.children ? hydrate(item.children) : [],
                isOpen: item.isOpen !== undefined ? item.isOpen : true // Default open
            }));
        };
        setLinks(hydrate(initialLinks || []));
    }, [initialLinks]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // Prevent accidental drags
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Flatten logic for dnd-kit
    // We only drag at the top level for categories, or items within categories.
    // However, to allow moving an item IN/OUT of a category, we need a unified context or handle it carefully.
    // For simplicity V1: 
    // - Root list uses SortableContext. 
    // - Sub-lists use SortableContext.
    // - Cross-container dragging is allowed.

    const findItem = (id: string, items: LinkItem[]): { item: LinkItem, parent: LinkItem | null } | null => {
        for (const item of items) {
            if (item.id === id) return { item, parent: null };
            if (item.children) {
                const found = findItem(id, item.children);
                if (found) {
                    // correct the parent reference if we recursed
                    return found.parent ? found : { item: found.item, parent: item };
                }
            }
        }
        return null;
    };

    const addLink = (parentId: string | null = null) => {
        const newItem: LinkItem = {
            id: `new-${Math.random().toString(36).substr(2, 9)}`,
            label: "New Link",
            href: "/",
            type: 'custom'
        };

        if (!parentId) {
            setLinks([...links, newItem]);
        } else {
            setLinks(currentLinks => {
                const deepUpdate = (items: LinkItem[]): LinkItem[] => {
                    return items.map(item => {
                        if (item.id === parentId) {
                            return { ...item, children: [...(item.children || []), newItem] };
                        }
                        if (item.children) {
                            return { ...item, children: deepUpdate(item.children) };
                        }
                        return item;
                    });
                };
                return deepUpdate(currentLinks);
            });
        }
    };

    const addCategory = () => {
        setLinks([...links, {
            id: `cat-${Math.random().toString(36).substr(2, 9)}`,
            label: "New Category",
            href: "#",
            type: 'category',
            isOpen: true,
            children: []
        }]);
    };

    const updateLink = (id: string, field: keyof LinkItem, value: any) => {
        const deepUpdate = (items: LinkItem[]): LinkItem[] => {
            return items.map(item => {
                if (item.id === id) {
                    return { ...item, [field]: value };
                }
                if (item.children) {
                    return { ...item, children: deepUpdate(item.children) };
                }
                return item;
            });
        };
        setLinks(deepUpdate(links));
    };

    const removeLink = (id: string) => {
        const deepDelete = (items: LinkItem[]): LinkItem[] => {
            return items.filter(item => item.id !== id).map(item => ({
                ...item,
                children: item.children ? deepDelete(item.children) : []
            }));
        };
        setLinks(deepDelete(links));
    };

    // DND Handlers

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        if (!over) return;

        // Find containers
        const activeNode = findItem(active.id as string, links);
        const overNode = findItem(over.id as string, links);

        if (!activeNode || !overNode) return;

        // If hovering over a category, we might want to drop into it.
        // But Sortable usually handles reordering. 
        // We will stick to standard list reordering for validation first, 
        // allowing drag-and-drop between lists IF the libraries allow simple passing of items.
        // Implementation detail: We treat the whole tree as a flattened list of "sortables" 
        // but that's complex. 
        // 
        // ALTERNATIVE: Simplification.
        // We only allow sorting within the SAME parent level for now to ensure stability 
        // unless we built a full tree sorter.
        // "Drag and drop them into each main category" was the request.

        // This suggests we SHOULD allow moving from Root -> Category.
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        if (activeId === overId) return;

        // Find source and destination lists (arrays)
        // This is tricky with nested recursion without a flat map.
        // We'll traverse.

        const findContainer = (id: string, items: LinkItem[]): LinkItem[] | null => {
            if (items.find(i => i.id === id)) return items;
            for (const item of items) {
                if (item.children) {
                    const found = findContainer(id, item.children);
                    if (found) return found;
                }
            }
            return null;
        };

        const activeContainer = findContainer(activeId, links);
        const overContainer = findContainer(overId, links);

        if (!activeContainer || !overContainer) return;

        // Moving within the same list
        if (activeContainer === overContainer) {
            setLinks(prev => {
                const deepUpdate = (items: LinkItem[]): LinkItem[] => {
                    // Check if this level contains our items
                    if (items.find(i => i.id === activeId)) {
                        const oldIndex = items.findIndex(i => i.id === activeId);
                        const newIndex = items.findIndex(i => i.id === overId);
                        return arrayMove(items, oldIndex, newIndex);
                    }
                    return items.map(item => ({
                        ...item,
                        children: item.children ? deepUpdate(item.children) : []
                    }));
                };
                return deepUpdate(prev);
            });
        }
        // Moving between lists (Root <-> Category)
        else {
            // 1. Remove from source
            // 2. Add to dest at appropriate index

            // This requires more complex logic to know insertion index relative to the 'over' item.
            // For V1 of this feature, we will LIMIT drag-and-drop to be within the same container 
            // to prevent data loss/complexity bugs, BUT we provide a UI to "Move" items if needed? 
            // Or we just rely on robust collision detection. 

            // Let's implement robust Move:
            setLinks(prev => {
                let itemToMove: LinkItem | null = null;

                // Remove phase
                const removePhase = (items: LinkItem[]): LinkItem[] => {
                    const found = items.find(i => i.id === activeId);
                    if (found) {
                        itemToMove = found;
                        return items.filter(i => i.id !== activeId);
                    }
                    return items.map(i => ({
                        ...i,
                        children: i.children ? removePhase(i.children) : []
                    }));
                };

                const newLinksAfterRemove = removePhase(prev);

                if (!itemToMove) return prev;

                // Add phase
                const addPhase = (items: LinkItem[]): LinkItem[] => {
                    // Check if 'overId' exists in this list
                    const overIndex = items.findIndex(i => i.id === overId);
                    if (overIndex !== -1) {
                        // Insert after or before? classic dnd problem. 
                        // We'll insert BEFORE for now.
                        const newItems = [...items];
                        newItems.splice(overIndex, 0, itemToMove!);
                        return newItems;
                    }
                    return items.map(i => ({
                        ...i,
                        children: i.children ? addPhase(i.children) : []
                    }));
                };

                return addPhase(newLinksAfterRemove);
            });
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Strip transient IDs and UI state before saving
            // Also recursively strip children
            const strip = (items: LinkItem[]): any[] => {
                return items.map(({ id, isOpen, children, ...rest }) => ({
                    ...rest,
                    ...(children && children.length > 0 ? { children: strip(children) } : {})
                }));
            };

            await saveNavigation(type, strip(links));
            toast.success("Menu saved");
        } catch (e) {
            toast.error("Failed to save menu");
        } finally {
            setSaving(false);
        }
    };

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({
            styles: {
                active: {
                    opacity: '0.4',
                },
            },
        }),
    };

    // --- Render Helpers ---

    const renderSortableList = (items: LinkItem[], parentId: string | null = null, depth = 0) => (
        <SortableContext
            items={items.map(l => l.id)}
            strategy={verticalListSortingStrategy}
            id={parentId || 'root'}
        >
            <div className={cn("space-y-2", depth === 0 ? "min-h-[100px]" : "min-h-[10px]")}>
                {items.length === 0 && depth > 0 && (
                    <div className="text-xs text-muted-foreground p-3 border border-dashed rounded bg-gray-50/50">
                        Empty category. Drop items here.
                    </div>
                )}

                {items.map((link, index) => (
                    <div key={link.id}>
                        <SortableLinkItem
                            link={link}
                            index={index}
                            parentId={parentId}
                            availablePages={availablePages}
                            updateLink={updateLink}
                            removeLink={removeLink}
                            depth={depth}
                        />
                        {/* Recursive Render for Open Categories */}
                        {link.type === 'category' && link.children && link.isOpen && (
                            <div className="pl-6 border-l-2 border-dashed border-gray-100 ml-4 mb-4 mt-2">
                                {renderSortableList(link.children, link.id, depth + 1)}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => addLink(link.id)}
                                    className="mt-2 text-xs text-muted-foreground hover:text-primary w-full justify-start h-7"
                                >
                                    <Plus className="w-3 h-3 mr-2" />
                                    Add Item to {link.label}
                                </Button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </SortableContext>
    );

    return (
        <div className="max-w-2xl mx-auto">
            <div className="border rounded-xl p-6 space-y-6 bg-white shadow-sm">
                <div className="flex justify-between items-center border-b pb-4">
                    <div className="space-y-1">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            {type === 'nav' ? 'Main Menu' : type === 'footer' ? 'Footer Menu' : 'Legal Menu'}
                            <span className="text-xs font-normal text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">
                                {links.reduce((acc, item) => acc + 1 + (item.children?.length || 0), 0)} items
                            </span>
                        </h3>
                        <p className="text-sm text-gray-500">
                            Drag and drop to reorder. Use "Add Category" to create dropdowns.
                        </p>
                    </div>

                    <Button onClick={handleSave} disabled={saving} className="bg-black text-white hover:bg-gray-800 shadow-sm">
                        {saving ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
                    </Button>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    measuring={{
                        droppable: {
                            strategy: MeasuringStrategy.Always,
                        },
                    }}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                >
                    {renderSortableList(links)}

                    <DragOverlay dropAnimation={dropAnimation}>
                        {activeId ? (
                            <div className="opacity-90 rotate-2 cursor-grabbing">
                                <div className="p-4 bg-white border rounded-lg shadow-xl ring-2 ring-primary">
                                    Moving Item...
                                </div>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>

                <div className="grid grid-cols-2 gap-3 pt-4 border-t">
                    <Button variant="outline" className="border-dashed h-10" onClick={() => addLink()}>
                        <Plus className="w-4 h-4 mr-2" /> Add Simple Link
                    </Button>
                    <Button variant="outline" className="border-dashed bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-700 h-10" onClick={addCategory}>
                        <Folder className="w-4 h-4 mr-2" /> Add Category
                    </Button>
                </div>
            </div>
        </div>
    );
}
