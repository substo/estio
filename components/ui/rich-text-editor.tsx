"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Toggle } from "@/components/ui/toggle";
import {
    Bold,
    Italic,
    Underline as UnderlineIcon,
    Strikethrough,
    List,
    ListOrdered,
    Link as LinkIcon,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Undo,
    Redo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from 'react';

interface RichTextEditorProps {
    content: string;
    onChange: (content: string) => void;
    placeholder?: string;
    className?: string;
}

export function RichTextEditor({ content, onChange, placeholder, className }: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            Underline,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: 'text-primary underline cursor-pointer',
                },
            }),
            TextAlign.configure({
                types: ['heading', 'paragraph'],
            }),
        ],
        immediatelyRender: false,
        content: content,
        editorProps: {
            attributes: {
                class: 'prose prose-sm sm:prose-base lg:prose-lg xl:prose-2xl m-5 focus:outline-none min-h-[150px]',
            },
        },
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
    });

    // Update editor content if content prop changes externally (and not just by the editor itself)
    // This is a bit tricky with Tiptap to avoid cursor jumping, so we only do it if the content is significantly different
    // or if the editor is empty. For now, we'll assume controlled input is primarily handled by the parent updating the state
    // that is passed back in, but Tiptap manages its own internal state.
    // A common pattern is to only update if the editor is not focused or if the content is completely different.
    // For this simple use case, we might not need a complex useEffect if the parent just passes the initial state.
    // However, if we want to support resetting the form, we need this.
    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            // Only update if the content is actually different to avoid cursor jumps on every keystroke
            // if the parent updates the prop on every change.
            // But if the parent updates on every change, this will still trigger.
            // Better to only set content if the editor is empty or we are resetting.
            // For now, let's rely on the initial content and only update if it's empty (reset).
            if (editor.isEmpty && content) {
                editor.commands.setContent(content);
            }
        }
    }, [content, editor]);


    if (!editor) {
        return null;
    }

    const setLink = () => {
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL', previousUrl);

        // cancelled
        if (url === null) {
            return;
        }

        // empty
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        // update
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };

    return (
        <div className={cn("border rounded-md", className)}>
            <div className="border-b p-2 flex flex-wrap gap-1 bg-muted/50">
                <Toggle
                    size="sm"
                    pressed={editor.isActive('bold')}
                    onPressedChange={() => editor.chain().focus().toggleBold().run()}
                    aria-label="Toggle bold"
                >
                    <Bold className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={editor.isActive('italic')}
                    onPressedChange={() => editor.chain().focus().toggleItalic().run()}
                    aria-label="Toggle italic"
                >
                    <Italic className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={editor.isActive('underline')}
                    onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
                    aria-label="Toggle underline"
                >
                    <UnderlineIcon className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={editor.isActive('strike')}
                    onPressedChange={() => editor.chain().focus().toggleStrike().run()}
                    aria-label="Toggle strikethrough"
                >
                    <Strikethrough className="h-4 w-4" />
                </Toggle>

                <div className="w-px h-6 bg-border mx-1 self-center" />

                <Toggle
                    size="sm"
                    pressed={editor.isActive('bulletList')}
                    onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
                    aria-label="Toggle bullet list"
                >
                    <List className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={editor.isActive('orderedList')}
                    onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
                    aria-label="Toggle ordered list"
                >
                    <ListOrdered className="h-4 w-4" />
                </Toggle>

                <div className="w-px h-6 bg-border mx-1 self-center" />

                <Toggle
                    size="sm"
                    pressed={editor.isActive({ textAlign: 'left' })}
                    onPressedChange={() => editor.chain().focus().setTextAlign('left').run()}
                    aria-label="Align left"
                >
                    <AlignLeft className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={editor.isActive({ textAlign: 'center' })}
                    onPressedChange={() => editor.chain().focus().setTextAlign('center').run()}
                    aria-label="Align center"
                >
                    <AlignCenter className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={editor.isActive({ textAlign: 'right' })}
                    onPressedChange={() => editor.chain().focus().setTextAlign('right').run()}
                    aria-label="Align right"
                >
                    <AlignRight className="h-4 w-4" />
                </Toggle>

                <div className="w-px h-6 bg-border mx-1 self-center" />

                <Toggle
                    size="sm"
                    pressed={editor.isActive('link')}
                    onPressedChange={setLink}
                    aria-label="Add link"
                >
                    <LinkIcon className="h-4 w-4" />
                </Toggle>

                <div className="w-px h-6 bg-border mx-1 self-center" />

                <Toggle
                    size="sm"
                    pressed={false}
                    onPressedChange={() => editor.chain().focus().undo().run()}
                    disabled={!editor.can().chain().focus().undo().run()}
                    aria-label="Undo"
                >
                    <Undo className="h-4 w-4" />
                </Toggle>
                <Toggle
                    size="sm"
                    pressed={false}
                    onPressedChange={() => editor.chain().focus().redo().run()}
                    disabled={!editor.can().chain().focus().redo().run()}
                    aria-label="Redo"
                >
                    <Redo className="h-4 w-4" />
                </Toggle>
            </div>
            <EditorContent editor={editor} className="p-2 min-h-[150px]" />
        </div>
    );
}
