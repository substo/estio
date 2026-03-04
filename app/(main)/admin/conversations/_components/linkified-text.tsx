import React from "react";

// Industry-standard URL regex (similar to Gruber's) that avoids capturing trailing punctuation
const URL_REGEX = /(\b(?:https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

export function LinkifiedText({ text }: { text: string }) {
    if (!text) return null;

    const parts = text.split(URL_REGEX);

    return (
        <>
            {parts.map((part, i) => {
                if (part.match(URL_REGEX)) {
                    return (
                        <a
                            key={i}
                            href={part}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80 break-all"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {part}
                        </a>
                    );
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </>
    );
}
