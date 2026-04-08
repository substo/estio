"use client";

import {
    forwardRef,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { resolveEditorDimensions } from "@/lib/ai/property-image-editor";
import { cn } from "@/lib/utils";

export type PrecisionMaskTool = "brush" | "box";

type Point = {
    x: number;
    y: number;
};

type StrokeAction = {
    kind: "stroke";
    erase: boolean;
    brushSize: number;
    points: Point[];
};

type BoxAction = {
    kind: "box";
    erase: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
};

type MaskAction = StrokeAction | BoxAction;

type DraftAction = StrokeAction | BoxAction | null;

export interface PrecisionMaskSelectableRegionBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PrecisionMaskSelectableRegion {
    id: string;
    label: string;
    bbox: PrecisionMaskSelectableRegionBoundingBox;
    confidence?: number;
}

export interface PrecisionMaskEditorState {
    isReady: boolean;
    canUndo: boolean;
    canRedo: boolean;
    hasMask: boolean;
    maskCoverage: number;
    editorWidth: number;
    editorHeight: number;
    naturalWidth: number;
    naturalHeight: number;
}

export interface PrecisionMaskSnapshot {
    maskPngBase64: string;
    editorWidth: number;
    editorHeight: number;
    maskCoverage: number;
}

export interface PrecisionMaskEditorHandle {
    undo: () => void;
    redo: () => void;
    clear: () => void;
    applyRegionMask: (input: { bbox: PrecisionMaskSelectableRegionBoundingBox; erase?: boolean }) => void;
    exportMask: () => Promise<PrecisionMaskSnapshot | null>;
}

interface PropertyImageMaskEditorProps {
    imageUrl: string;
    tool: PrecisionMaskTool;
    brushSize: number;
    eraseMode: boolean;
    selectableRegions?: PrecisionMaskSelectableRegion[];
    clickSelectEnabled?: boolean;
    onSelectableRegionApplied?: (payload: { regionId: string; action: "add" | "erase" }) => void;
    disabled?: boolean;
    onStateChange?: (state: PrecisionMaskEditorState) => void;
    className?: string;
}

const MASK_DRAW_COLOR = "rgba(255, 84, 84, 1)";

function normalizeBox(action: BoxAction): BoxAction {
    const x = action.width >= 0 ? action.x : action.x + action.width;
    const y = action.height >= 0 ? action.y : action.y + action.height;
    return {
        ...action,
        x,
        y,
        width: Math.abs(action.width),
        height: Math.abs(action.height),
    };
}

function drawMaskAction(ctx: CanvasRenderingContext2D, action: MaskAction) {
    ctx.save();
    ctx.globalCompositeOperation = action.erase ? "destination-out" : "source-over";
    ctx.fillStyle = MASK_DRAW_COLOR;
    ctx.strokeStyle = MASK_DRAW_COLOR;

    if (action.kind === "stroke") {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = action.brushSize;

        if (action.points.length === 1) {
            const [point] = action.points;
            ctx.beginPath();
            ctx.arc(point.x, point.y, action.brushSize / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (action.points.length > 1) {
            ctx.beginPath();
            action.points.forEach((point, index) => {
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.stroke();
        }
    } else {
        const box = normalizeBox(action);
        ctx.fillRect(box.x, box.y, box.width, box.height);
    }

    ctx.restore();
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function normalizeSelectableRegionBoundingBox(
    bbox: PrecisionMaskSelectableRegionBoundingBox
): PrecisionMaskSelectableRegionBoundingBox | null {
    const x = clamp01(Number(bbox?.x));
    const y = clamp01(Number(bbox?.y));
    const width = Math.max(0, clamp01(Number(bbox?.width)));
    const height = Math.max(0, clamp01(Number(bbox?.height)));
    if (width <= 0 || height <= 0) return null;
    if (x >= 1 || y >= 1) return null;

    const clampedWidth = Math.min(width, 1 - x);
    const clampedHeight = Math.min(height, 1 - y);
    if (clampedWidth <= 0 || clampedHeight <= 0) return null;

    return {
        x,
        y,
        width: clampedWidth,
        height: clampedHeight,
    };
}

function toPixelBox(
    bbox: PrecisionMaskSelectableRegionBoundingBox,
    editorWidth: number,
    editorHeight: number
): BoxAction {
    return {
        kind: "box",
        erase: false,
        x: bbox.x * editorWidth,
        y: bbox.y * editorHeight,
        width: bbox.width * editorWidth,
        height: bbox.height * editorHeight,
    };
}

function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return { x: 0, y: 0 };
    }

    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

    return {
        x: Math.max(0, Math.min(canvas.width, x)),
        y: Math.max(0, Math.min(canvas.height, y)),
    };
}

export const PropertyImageMaskEditor = forwardRef<PrecisionMaskEditorHandle, PropertyImageMaskEditorProps>(
    function PropertyImageMaskEditor({
        imageUrl,
        tool,
        brushSize,
        eraseMode = false,
        selectableRegions = [],
        clickSelectEnabled = false,
        onSelectableRegionApplied,
        disabled = false,
        onStateChange,
        className,
    }, ref) {
        const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
        const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
        const imageRef = useRef<HTMLImageElement | null>(null);
        const [actions, setActions] = useState<MaskAction[]>([]);
        const [redoActions, setRedoActions] = useState<MaskAction[]>([]);
        const [draftAction, setDraftAction] = useState<DraftAction>(null);
        const [isReady, setIsReady] = useState(false);
        const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
        const [editorSize, setEditorSize] = useState({ width: 0, height: 0 });
        const [maskCoverage, setMaskCoverage] = useState(0);

        const aspectRatio = useMemo(() => {
            if (!editorSize.width || !editorSize.height) return 16 / 9;
            return editorSize.width / editorSize.height;
        }, [editorSize.height, editorSize.width]);

        const interactiveSelectableRegions = useMemo(() => (
            selectableRegions
                .map((region) => {
                    const normalizedBbox = normalizeSelectableRegionBoundingBox(region.bbox);
                    if (!normalizedBbox) return null;
                    return {
                        ...region,
                        bbox: normalizedBbox,
                    };
                })
                .filter(Boolean) as PrecisionMaskSelectableRegion[]
        ), [selectableRegions]);

        useEffect(() => {
            let cancelled = false;
            setIsReady(false);
            setActions([]);
            setRedoActions([]);
            setDraftAction(null);
            setMaskCoverage(0);

            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                if (cancelled) return;
                imageRef.current = image;
                const resolved = resolveEditorDimensions(image.naturalWidth, image.naturalHeight);
                setNaturalSize({
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                });
                setEditorSize({
                    width: resolved.width,
                    height: resolved.height,
                });
                setIsReady(true);
            };
            image.onerror = () => {
                if (cancelled) return;
                imageRef.current = null;
                setNaturalSize({ width: 0, height: 0 });
                setEditorSize({ width: 0, height: 0 });
                setIsReady(false);
            };
            image.src = imageUrl;

            return () => {
                cancelled = true;
            };
        }, [imageUrl]);

        useEffect(() => {
            const canvas = imageCanvasRef.current;
            const image = imageRef.current;
            if (!canvas || !image || !editorSize.width || !editorSize.height) return;

            canvas.width = editorSize.width;
            canvas.height = editorSize.height;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        }, [editorSize.height, editorSize.width, isReady]);

        useEffect(() => {
            const canvas = maskCanvasRef.current;
            if (!canvas || !editorSize.width || !editorSize.height) return;

            canvas.width = editorSize.width;
            canvas.height = editorSize.height;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const action of actions) {
                drawMaskAction(ctx, action);
            }
            if (draftAction) {
                drawMaskAction(ctx, draftAction);
            }
        }, [actions, draftAction, editorSize.height, editorSize.width]);

        useEffect(() => {
            const canvas = maskCanvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (!canvas || !ctx || !editorSize.width || !editorSize.height || actions.length === 0) {
                setMaskCoverage(0);
                return;
            }

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let activePixels = 0;
            for (let index = 3; index < imageData.data.length; index += 4) {
                if (imageData.data[index] > 0) {
                    activePixels += 1;
                }
            }
            setMaskCoverage(activePixels / Math.max(1, canvas.width * canvas.height));
        }, [actions, editorSize.height, editorSize.width]);

        useEffect(() => {
            onStateChange?.({
                isReady,
                canUndo: actions.length > 0,
                canRedo: redoActions.length > 0,
                hasMask: maskCoverage > 0,
                maskCoverage,
                editorWidth: editorSize.width,
                editorHeight: editorSize.height,
                naturalWidth: naturalSize.width,
                naturalHeight: naturalSize.height,
            });
        }, [
            actions.length,
            editorSize.height,
            editorSize.width,
            isReady,
            maskCoverage,
            naturalSize.height,
            naturalSize.width,
            onStateChange,
            redoActions.length,
        ]);

        useImperativeHandle(ref, () => ({
            undo() {
                setDraftAction(null);
                setActions((prev) => {
                    if (prev.length === 0) return prev;
                    const next = prev.slice(0, -1);
                    const removed = prev[prev.length - 1];
                    setRedoActions((redoPrev) => [...redoPrev, removed]);
                    return next;
                });
            },
            redo() {
                setDraftAction(null);
                setRedoActions((prev) => {
                    if (prev.length === 0) return prev;
                    const restored = prev[prev.length - 1];
                    setActions((actionPrev) => [...actionPrev, restored]);
                    return prev.slice(0, -1);
                });
            },
            clear() {
                setDraftAction(null);
                setActions([]);
                setRedoActions([]);
            },
            applyRegionMask({ bbox, erase = false }) {
                if (!editorSize.width || !editorSize.height || !isReady) return;
                const normalizedBbox = normalizeSelectableRegionBoundingBox(bbox);
                if (!normalizedBbox) return;
                const action = toPixelBox(normalizedBbox, editorSize.width, editorSize.height);
                commitAction({
                    ...action,
                    erase,
                });
            },
            async exportMask() {
                const canvas = maskCanvasRef.current;
                if (!canvas || !editorSize.width || !editorSize.height || maskCoverage <= 0) {
                    return null;
                }

                const dataUrl = canvas.toDataURL("image/png");
                const marker = "base64,";
                const markerIndex = dataUrl.indexOf(marker);
                return {
                    maskPngBase64: markerIndex >= 0 ? dataUrl.slice(markerIndex + marker.length) : dataUrl,
                    editorWidth: editorSize.width,
                    editorHeight: editorSize.height,
                    maskCoverage,
                };
            },
        }), [editorSize.height, editorSize.width, isReady, maskCoverage]);

        function commitAction(action: MaskAction | null) {
            if (!action) return;

            if (action.kind === "stroke" && action.points.length === 0) {
                setDraftAction(null);
                return;
            }

            if (action.kind === "box") {
                const normalized = normalizeBox(action);
                if (normalized.width < 1 || normalized.height < 1) {
                    setDraftAction(null);
                    return;
                }
                action = normalized;
            }

            setActions((prev) => [...prev, action]);
            setRedoActions([]);
            setDraftAction(null);
        }

        function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
            if (disabled || !isReady || !maskCanvasRef.current) return;
            const canvas = maskCanvasRef.current;
            const point = getCanvasPoint(event, canvas);
            event.currentTarget.setPointerCapture(event.pointerId);

            if (tool === "brush") {
                setDraftAction({
                    kind: "stroke",
                    erase: eraseMode,
                    brushSize,
                    points: [point],
                });
                return;
            }

            setDraftAction({
                kind: "box",
                erase: eraseMode,
                x: point.x,
                y: point.y,
                width: 0,
                height: 0,
            });
        }

        function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
            if (disabled || !draftAction || !maskCanvasRef.current) return;
            const canvas = maskCanvasRef.current;
            const point = getCanvasPoint(event, canvas);

            if (draftAction.kind === "stroke") {
                setDraftAction({
                    ...draftAction,
                    points: [...draftAction.points, point],
                });
                return;
            }

            setDraftAction({
                ...draftAction,
                width: point.x - draftAction.x,
                height: point.y - draftAction.y,
            });
        }

        function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
            if (!draftAction) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            commitAction(draftAction);
        }

        function handlePointerLeave(event: ReactPointerEvent<HTMLCanvasElement>) {
            if (!draftAction || !(event.buttons & 1)) return;
            handlePointerUp(event);
        }

        function handleSelectableRegionClick(region: PrecisionMaskSelectableRegion) {
            if (!isReady || disabled || !editorSize.width || !editorSize.height) return;
            const action = toPixelBox(region.bbox, editorSize.width, editorSize.height);
            commitAction({
                ...action,
                erase: eraseMode,
            });
            onSelectableRegionApplied?.({
                regionId: region.id,
                action: eraseMode ? "erase" : "add",
            });
        }

        return (
            <div className={cn("space-y-2", className)}>
                <div
                    className="relative w-full overflow-hidden rounded-lg border bg-black/90"
                    style={{ aspectRatio }}
                >
                    {!isReady ? (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                            Loading image editor...
                        </div>
                    ) : null}

                    <canvas
                        ref={imageCanvasRef}
                        className="absolute inset-0 h-full w-full"
                    />

                    <canvas
                        ref={maskCanvasRef}
                        className={cn(
                            "absolute inset-0 h-full w-full touch-none",
                            disabled ? "pointer-events-none" : "cursor-crosshair"
                        )}
                        style={{ opacity: 0.45 }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        onPointerLeave={handlePointerLeave}
                    />

                    {clickSelectEnabled && interactiveSelectableRegions.length > 0 ? (
                        <div className="absolute inset-0 pointer-events-none">
                            {interactiveSelectableRegions.map((region) => (
                                <button
                                    key={region.id}
                                    type="button"
                                    title={`${region.label}${region.confidence !== undefined ? ` (${Math.round(region.confidence * 100)}%)` : ""}`}
                                    className={cn(
                                        "absolute min-h-3 min-w-3 rounded-sm border-2 border-cyan-300/80 bg-cyan-400/10 transition-colors",
                                        "hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                                        disabled ? "pointer-events-none" : "pointer-events-auto"
                                    )}
                                    style={{
                                        left: `${region.bbox.x * 100}%`,
                                        top: `${region.bbox.y * 100}%`,
                                        width: `${region.bbox.width * 100}%`,
                                        height: `${region.bbox.height * 100}%`,
                                    }}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        handleSelectableRegionClick(region);
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
);
