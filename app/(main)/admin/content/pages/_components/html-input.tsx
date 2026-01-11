"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BrandColor } from "@/components/editor/extensions/brand-color";
import { cn } from "@/lib/utils";
import { useEffect } from 'react';

interface HtmlInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    multiline?: boolean;
    siteConfig?: any;
}

export function HtmlInput({ value, onChange, placeholder, className, multiline = false, siteConfig }: HtmlInputProps) {
    // Extract Colors from Site Config
    const theme = siteConfig?.theme || {};
    const colors = [
        { name: "Primary", class: "text-primary", hex: theme.primaryColor || "#000000" },
        { name: "Secondary", class: "text-secondary", hex: theme.secondaryColor || "#64748b" },
        { name: "Accent", class: "text-accent", hex: theme.accentColor || "#f59e0b" },
        // { name: "Muted", class: "text-muted-foreground", hex: "#94a3b8" },
    ];

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: false,
                bulletList: false,
                orderedList: false,
                listItem: false,
                codeBlock: false,
                horizontalRule: false,
                blockquote: false,
            }),
            BrandColor,
        ],
        content: value,
        editorProps: {
            attributes: {
                class: cn(
                    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                    multiline ? "min-h-[80px]" : "h-10 truncate overflow-hidden flex items-center", // Single line vs Multi logic
                    className
                ),
            },
        },
        onUpdate: ({ editor }) => {
            const html = editor.getHTML();
            // Tiptap wraps single line in <p>, we might want to strip it if strict one-liner needed?
            // For now, let's keep it robust.
            // Actually, for headlines we probably don't want top-level paragraph tags if renders inside an H1.
            // But let's verify output.
            onChange(html);
        },
    });

    // Update content if value changes externally (e.g. initial load or reset)
    useEffect(() => {
        if (editor && value !== editor.getHTML()) {
            // Only update if significantly different to avoid cursor jumping
            // Naive check: if completely different, replace.
            // Ideally we don't sync back often.
            if (!editor.isFocused) {
                editor.commands.setContent(value);
            }
        }
    }, [value, editor]);


    const toggleColor = (colorClass: string) => {
        if (!editor) return;

        // If already has class, unset it? Or just set?
        // Mark usually toggles.
        // We want to apply this class.

        if (editor.isActive('brandColor', { class: colorClass })) {
            editor.chain().focus().unsetMark('brandColor').run();
        } else {
            // Unset others first to avoid mixing?
            editor.chain().focus().unsetMark('brandColor').setMark('brandColor', { class: colorClass }).run();
        }
    };

    if (!editor) return null;

    return (
        <div className="relative group">
            {/* Floating Toolbar */}
            <div className="absolute right-0 top-[-30px] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex gap-1 bg-white border shadow-sm rounded-md p-0.5 z-10">
                {colors.map((color) => (
                    <button
                        key={color.name}
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            toggleColor(color.class);
                        }}
                        className={cn(
                            "w-5 h-5 rounded-full border border-slate-200 hover:scale-110 transition-transform flex items-center justify-center",
                            editor.isActive('brandColor', { class: color.class }) && "ring-2 ring-offset-1 ring-slate-400"
                        )}
                        title={`Apply ${color.name} Color`}
                        style={{ backgroundColor: color.hex }}
                    >
                    </button>
                ))}
            </div>

            <EditorContent editor={editor} />
        </div>
    );
}
