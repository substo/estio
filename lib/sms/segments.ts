export type SmsEncoding = "gsm-7" | "unicode";

export type SmsSegmentInfo = {
    encoding: SmsEncoding;
    units: number;
    segments: number;
    segmentLimit: number;
    remaining: number;
};

const GSM_BASIC_CHARS = new Set(
    [
        "@", "£", "$", "¥", "è", "é", "ù", "ì", "ò", "Ç", "\n", "Ø", "ø", "\r", "Å", "å",
        "Δ", "_", "Φ", "Γ", "Λ", "Ω", "Π", "Ψ", "Σ", "Θ", "Ξ", "Æ", "æ", "ß", "É",
        " ", "!", "\"", "#", "¤", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?",
        "¡", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
        "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "Ä", "Ö", "Ñ", "Ü", "§",
        "¿", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
        "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "ä", "ö", "ñ", "ü", "à",
    ]
);

const GSM_EXTENDED_CHARS = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export function getSmsSegmentInfo(text: string): SmsSegmentInfo {
    let gsmUnits = 0;
    let isGsm = true;

    for (const char of String(text || "")) {
        if (GSM_BASIC_CHARS.has(char)) {
            gsmUnits += 1;
        } else if (GSM_EXTENDED_CHARS.has(char)) {
            gsmUnits += 2;
        } else {
            isGsm = false;
            break;
        }
    }

    const units = isGsm ? gsmUnits : Array.from(String(text || "")).length;
    const singleLimit = isGsm ? 160 : 70;
    const multipartLimit = isGsm ? 153 : 67;
    const segments = units <= singleLimit ? (units > 0 ? 1 : 0) : Math.ceil(units / multipartLimit);
    const segmentLimit = segments > 1 ? multipartLimit : singleLimit;
    const remaining = segments === 0
        ? singleLimit
        : (segments * segmentLimit) - units;

    return {
        encoding: isGsm ? "gsm-7" : "unicode",
        units,
        segments,
        segmentLimit,
        remaining,
    };
}
