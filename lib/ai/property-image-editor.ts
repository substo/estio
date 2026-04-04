export const DEFAULT_EDITOR_MAX_LONG_EDGE = 2048;

export interface ResolvedEditorDimensions {
    width: number;
    height: number;
    scale: number;
}

export function resolveEditorDimensions(
    width: number,
    height: number,
    maxLongEdge: number = DEFAULT_EDITOR_MAX_LONG_EDGE
): ResolvedEditorDimensions {
    const sourceWidth = Math.max(1, Math.round(Number(width) || 1));
    const sourceHeight = Math.max(1, Math.round(Number(height) || 1));
    const safeMaxLongEdge = Math.max(1, Math.round(Number(maxLongEdge) || DEFAULT_EDITOR_MAX_LONG_EDGE));
    const longEdge = Math.max(sourceWidth, sourceHeight);

    if (longEdge <= safeMaxLongEdge) {
        return {
            width: sourceWidth,
            height: sourceHeight,
            scale: 1,
        };
    }

    const scale = safeMaxLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale)),
        scale,
    };
}
