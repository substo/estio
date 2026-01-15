import { parseString } from 'whatsapp-chat-parser';

export interface ParsedMessage {
    date: Date;
    author: string | null;
    message: string;
}

export interface ParseResult {
    messages: ParsedMessage[];
    uniqueAuthors: string[];
    messageCount: number;
    errors: string[];
}

/**
 * Parse a WhatsApp chat export .txt file content
 * Uses the whatsapp-chat-parser library for robust handling of various formats
 */
export async function parseWhatsAppExport(content: string): Promise<ParseResult> {
    const errors: string[] = [];

    try {
        // Use the library parser
        const messages = await parseString(content);

        // Extract unique authors (excluding null/system messages)
        const authorSet = new Set<string>();
        const parsedMessages: ParsedMessage[] = [];

        for (const msg of messages) {
            // Skip system messages (author is null or empty)
            if (!msg.author) continue;

            // Skip known system message patterns
            const systemPatterns = [
                'Messages and calls are end-to-end encrypted',
                'is a contact',
                'You deleted this message',
                'This message was deleted',
                'changed the subject',
                'added you',
                'left the group',
                'joined using',
                'created group'
            ];

            const isSystemMessage = systemPatterns.some(pattern =>
                msg.message?.toLowerCase().includes(pattern.toLowerCase())
            );

            if (isSystemMessage) continue;

            authorSet.add(msg.author);
            parsedMessages.push({
                date: msg.date,
                author: msg.author,
                message: msg.message || ''
            });
        }

        return {
            messages: parsedMessages,
            uniqueAuthors: Array.from(authorSet).sort(),
            messageCount: parsedMessages.length,
            errors
        };

    } catch (error: any) {
        errors.push(`Parser error: ${error.message}`);
        return {
            messages: [],
            uniqueAuthors: [],
            messageCount: 0,
            errors
        };
    }
}

/**
 * Preview first N messages from parsed content
 */
export function previewMessages(messages: ParsedMessage[], count: number = 10): ParsedMessage[] {
    return messages.slice(0, count);
}
