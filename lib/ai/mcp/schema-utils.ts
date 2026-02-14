import { z } from "zod";
import { SchemaType } from "@google/generative-ai";

/**
 * Converts a Zod schema to a Google Generative AI FunctionDeclarationSchema.
 * Limit support to basic types used in our tools.
 */
export function zodToGeminiSchema(schema: z.ZodTypeAny): any {
    if (schema instanceof z.ZodObject) {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(schema.shape)) {
            properties[key] = zodToGeminiSchema(value as z.ZodTypeAny);
            if (!(value as z.ZodTypeAny).isOptional()) {
                required.push(key);
            }
        }

        return {
            type: SchemaType.OBJECT,
            properties,
            required: required.length > 0 ? required : undefined,
        };
    }

    if (schema instanceof z.ZodString) {
        const enumCheck = (schema as any)._def.checks.find((c: any) => c.kind === "enum");
        return {
            type: SchemaType.STRING,
            description: schema.description,
            enum: enumCheck?.values,
        };
    }

    if (schema instanceof z.ZodNumber) {
        return {
            type: SchemaType.NUMBER,
            description: schema.description,
        };
    }

    if (schema instanceof z.ZodBoolean) {
        return {
            type: SchemaType.BOOLEAN,
            description: schema.description,
        };
    }

    if (schema instanceof z.ZodArray) {
        return {
            type: SchemaType.ARRAY,
            items: zodToGeminiSchema(schema.element),
            description: schema.description,
        };
    }

    if (schema instanceof z.ZodEnum) {
        return {
            type: SchemaType.STRING,
            enum: schema.options,
            description: schema.description
        }
    }

    if (schema instanceof z.ZodOptional) {
        // For optional, we return the inner type, but the parent object handles the "required" list
        return zodToGeminiSchema(schema.unwrap());
    }

    // Fallback
    return {
        type: SchemaType.STRING,
    };
}
