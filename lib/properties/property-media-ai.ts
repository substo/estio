export const PROPERTY_IMAGE_AI_APPLY_MODES = [
    "replace_original",
    "add_before_original",
    "add_as_primary",
] as const;

export type PropertyImageAiApplyMode = typeof PROPERTY_IMAGE_AI_APPLY_MODES[number];

export interface PropertyImageAiEnhancementMetadata {
    version: 1;
    isAiGenerated?: boolean;
    sourceImageId?: string | null;
    sourceImageUrl?: string | null;
    applyMode?: PropertyImageAiApplyMode;
    hiddenFromGallery?: boolean;
    hiddenByImageId?: string | null;
    hiddenByImageUrl?: string | null;
}

export interface PropertyImageLike {
    url: string;
    cloudflareImageId?: string | null;
    kind: string;
    sortOrder: number;
    title?: string | null;
    metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSortOrder<T extends PropertyImageLike>(items: T[]): T[] {
    return items.map((item, index) => ({
        ...item,
        sortOrder: index,
    }));
}

function reorderByIndex<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
    if (fromIndex === toIndex) return [...items];
    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
}

function matchesSourceRef(
    item: PropertyImageLike,
    sourceImageId?: string | null,
    sourceImageUrl?: string | null
): boolean {
    if (sourceImageId && item.cloudflareImageId === sourceImageId) {
        return true;
    }

    return Boolean(sourceImageUrl && item.url === sourceImageUrl);
}

export function getPropertyMediaIdentity(item: Pick<PropertyImageLike, "url" | "cloudflareImageId">): string {
    return String(item.cloudflareImageId || item.url || "").trim();
}

export function getPropertyImageAiMetadata(item: Pick<PropertyImageLike, "metadata">): PropertyImageAiEnhancementMetadata | null {
    if (!isRecord(item.metadata)) {
        return null;
    }

    const candidate = item.metadata.aiEnhancement;
    if (!isRecord(candidate)) {
        return null;
    }

    return {
        version: 1,
        isAiGenerated: candidate.isAiGenerated === true,
        sourceImageId: typeof candidate.sourceImageId === "string" ? candidate.sourceImageId : null,
        sourceImageUrl: typeof candidate.sourceImageUrl === "string" ? candidate.sourceImageUrl : null,
        applyMode: typeof candidate.applyMode === "string" ? candidate.applyMode as PropertyImageAiApplyMode : undefined,
        hiddenFromGallery: candidate.hiddenFromGallery === true,
        hiddenByImageId: typeof candidate.hiddenByImageId === "string" ? candidate.hiddenByImageId : null,
        hiddenByImageUrl: typeof candidate.hiddenByImageUrl === "string" ? candidate.hiddenByImageUrl : null,
    };
}

export function setPropertyImageAiMetadata(
    metadata: unknown,
    patch: Partial<PropertyImageAiEnhancementMetadata> | null
): Record<string, unknown> | undefined {
    const base = isRecord(metadata) ? { ...metadata } : {};
    const current = getPropertyImageAiMetadata({ metadata }) || { version: 1 };

    if (!patch) {
        delete base.aiEnhancement;
        return Object.keys(base).length > 0 ? base : undefined;
    }

    const next: PropertyImageAiEnhancementMetadata = {
        ...current,
        ...patch,
        version: 1,
    };

    if (!next.hiddenFromGallery) {
        delete next.hiddenFromGallery;
        delete next.hiddenByImageId;
        delete next.hiddenByImageUrl;
    }

    base.aiEnhancement = next;
    return base;
}

export function isAiGeneratedPropertyImage(item: PropertyImageLike): boolean {
    return getPropertyImageAiMetadata(item)?.isAiGenerated === true;
}

export function isHiddenFromGallery(item: PropertyImageLike): boolean {
    return getPropertyImageAiMetadata(item)?.hiddenFromGallery === true;
}

export function canRevertAiGeneratedImage(item: PropertyImageLike, allImages: PropertyImageLike[]): boolean {
    const aiMetadata = getPropertyImageAiMetadata(item);
    if (!aiMetadata?.isAiGenerated || aiMetadata.applyMode !== "replace_original") {
        return false;
    }

    return allImages.some((candidate) => matchesSourceRef(candidate, aiMetadata.sourceImageId, aiMetadata.sourceImageUrl));
}

export function hasAiOriginalAvailable(item: PropertyImageLike, allImages: PropertyImageLike[]): boolean {
    const aiMetadata = getPropertyImageAiMetadata(item);
    if (!aiMetadata?.isAiGenerated) {
        return false;
    }

    return allImages.some((candidate) => matchesSourceRef(candidate, aiMetadata.sourceImageId, aiMetadata.sourceImageUrl));
}

export function getVisiblePropertyImageMedia<T extends PropertyImageLike>(items: T[]): T[] {
    return [...items]
        .filter((item) => item.kind === "IMAGE")
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .filter((item) => !isHiddenFromGallery(item));
}

export function getVisiblePropertyMedia<T extends PropertyImageLike>(items: T[]): T[] {
    return [...items]
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .filter((item) => item.kind !== "IMAGE" || !isHiddenFromGallery(item));
}

function buildAiGeneratedImage<T extends PropertyImageLike>(input: {
    sourceImage: T;
    generatedImage: Pick<PropertyImageLike, "url" | "cloudflareImageId">;
    applyMode: PropertyImageAiApplyMode;
}): T {
    return {
        ...(input.sourceImage as T),
        url: input.generatedImage.url,
        cloudflareImageId: input.generatedImage.cloudflareImageId || null,
        metadata: setPropertyImageAiMetadata(undefined, {
            version: 1,
            isAiGenerated: true,
            sourceImageId: input.sourceImage.cloudflareImageId || null,
            sourceImageUrl: input.sourceImage.url || null,
            applyMode: input.applyMode,
        }),
    };
}

export function applyAiGeneratedImage<T extends PropertyImageLike>(input: {
    images: T[];
    sourceImageIdentity: string;
    generatedImage: Pick<PropertyImageLike, "url" | "cloudflareImageId">;
    applyMode: PropertyImageAiApplyMode;
}): T[] {
    const sourceIndex = input.images.findIndex((item) => getPropertyMediaIdentity(item) === input.sourceImageIdentity);
    if (sourceIndex === -1) {
        return normalizeSortOrder(input.images);
    }

    const sourceImage = input.images[sourceIndex];
    const generatedImage = buildAiGeneratedImage({
        sourceImage,
        generatedImage: input.generatedImage,
        applyMode: input.applyMode,
    });

    if (input.applyMode === "replace_original") {
        const hiddenSource = {
            ...sourceImage,
            metadata: setPropertyImageAiMetadata(sourceImage.metadata, {
                hiddenFromGallery: true,
                hiddenByImageId: generatedImage.cloudflareImageId || null,
                hiddenByImageUrl: generatedImage.url,
            }),
        };

        return normalizeSortOrder([
            ...input.images.slice(0, sourceIndex),
            generatedImage as T,
            hiddenSource as T,
            ...input.images.slice(sourceIndex + 1),
        ]);
    }

    if (input.applyMode === "add_before_original") {
        return normalizeSortOrder([
            ...input.images.slice(0, sourceIndex),
            generatedImage as T,
            ...input.images.slice(sourceIndex),
        ]);
    }

    return normalizeSortOrder([
        generatedImage as T,
        ...input.images,
    ]);
}

export function revertAiGeneratedReplacement<T extends PropertyImageLike>(images: T[], aiImageIdentity: string): T[] {
    const aiIndex = images.findIndex((item) => getPropertyMediaIdentity(item) === aiImageIdentity);
    if (aiIndex === -1) {
        return normalizeSortOrder(images);
    }

    const aiImage = images[aiIndex];
    const aiMetadata = getPropertyImageAiMetadata(aiImage);
    if (!aiMetadata?.isAiGenerated || aiMetadata.applyMode !== "replace_original") {
        return normalizeSortOrder(images);
    }

    const restored = images
        .filter((_, index) => index !== aiIndex)
        .map((item) => {
            if (!matchesSourceRef(item, aiMetadata.sourceImageId, aiMetadata.sourceImageUrl)) {
                return item;
            }

            return {
                ...item,
                metadata: setPropertyImageAiMetadata(item.metadata, {
                    hiddenFromGallery: false,
                    hiddenByImageId: null,
                    hiddenByImageUrl: null,
                }),
            };
        });

    return normalizeSortOrder(restored as T[]);
}

export function removePropertyImageByIdentity<T extends PropertyImageLike>(images: T[], imageIdentity: string): T[] {
    const target = images.find((item) => getPropertyMediaIdentity(item) === imageIdentity);
    if (!target) {
        return normalizeSortOrder(images);
    }

    if (canRevertAiGeneratedImage(target, images)) {
        return revertAiGeneratedReplacement(images, imageIdentity);
    }

    return normalizeSortOrder(images.filter((item) => getPropertyMediaIdentity(item) !== imageIdentity));
}

export function reorderVisiblePropertyImagesByIdentity<T extends PropertyImageLike>(input: {
    images: T[];
    activeIdentity: string;
    overIdentity: string;
}): T[] {
    const activeIdentity = String(input.activeIdentity || "").trim();
    const overIdentity = String(input.overIdentity || "").trim();
    if (!activeIdentity || !overIdentity || activeIdentity === overIdentity) {
        return normalizeSortOrder([...input.images]);
    }

    const ordered = [...input.images].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const visible = getVisiblePropertyImageMedia(ordered);
    const oldIndex = visible.findIndex((item) => getPropertyMediaIdentity(item) === activeIdentity);
    const newIndex = visible.findIndex((item) => getPropertyMediaIdentity(item) === overIdentity);
    if (oldIndex < 0 || newIndex < 0) {
        return normalizeSortOrder(ordered);
    }

    const reorderedVisible = oldIndex === newIndex ? visible : reorderByIndex(visible, oldIndex, newIndex);
    const visibleIdentitySet = new Set(reorderedVisible.map((item) => getPropertyMediaIdentity(item)));

    const hiddenFollowersByVisibleIdentity = new Map<string, T[]>();
    const orphanHidden: T[] = [];

    ordered.forEach((item) => {
        if (!isHiddenFromGallery(item)) return;
        const metadata = getPropertyImageAiMetadata(item);
        const linkedIdentity = String(
            metadata?.hiddenByImageId
            || metadata?.hiddenByImageUrl
            || ""
        ).trim();

        if (!linkedIdentity || !visibleIdentitySet.has(linkedIdentity)) {
            orphanHidden.push(item);
            return;
        }

        const bucket = hiddenFollowersByVisibleIdentity.get(linkedIdentity) || [];
        bucket.push(item);
        hiddenFollowersByVisibleIdentity.set(linkedIdentity, bucket);
    });

    const nextOrdered: T[] = [];
    reorderedVisible.forEach((item) => {
        const identity = getPropertyMediaIdentity(item);
        nextOrdered.push(item);
        const followers = hiddenFollowersByVisibleIdentity.get(identity) || [];
        if (followers.length > 0) {
            nextOrdered.push(...followers);
        }
    });

    if (orphanHidden.length > 0) {
        nextOrdered.push(...orphanHidden);
    }

    return normalizeSortOrder(nextOrdered);
}
