import { Mark, mergeAttributes } from '@tiptap/core';

export const BrandColor = Mark.create({
    name: 'brandColor',

    addOptions() {
        return {
            HTMLAttributes: {},
        };
    },

    addAttributes() {
        return {
            class: {
                default: null,
                parseHTML: element => element.getAttribute('class'),
                renderHTML: attributes => {
                    if (!attributes.class) {
                        return {};
                    }
                    return {
                        class: attributes.class,
                    };
                },
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span',
                getAttrs: element => {
                    // Only match spans with our specific classes to avoid grabbing everything
                    const className = (element as HTMLElement).getAttribute('class');
                    if (className && (className.includes('text-primary') || className.includes('text-secondary') || className.includes('text-accent'))) {
                        return {};
                    }
                    return false;
                },
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
    },
});
