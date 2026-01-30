import { SkillLoader } from './loader';
import fs from 'fs';
import path from 'path';

/**
 * Tool: Load Skill
 * "Installs" the instructions for a specific skill into the agent's context.
 */
export async function loadSkillTool(skillName: string) {
    const skill = SkillLoader.loadSkill(skillName);
    if (!skill) {
        return {
            success: false,
            message: `Skill '${skillName}' not found. Please check the available skills in your system prompt.`
        };
    }
    return {
        success: true,
        skillName: skill.name,
        instructions: skill.instructions
    };
}

/**
 * Tool: Read Resource
 * Reads a deep reference file from the skill's references directory.
 */
export async function readResourceTool(skillName: string, filePath: string) {
    // 1. Sanitize Skill Name
    const safeSkill = skillName.replace(/[^a-zA-Z0-9_-]/g, '');

    // 2. Resolve Path
    // filePath is expected to be relative to the skill directory (e.g., "references/api.md")
    // We strictly enforce no ".." to prevent traversal
    if (filePath.includes('..')) {
        return { success: false, message: "Security Block: Invalid file path." };
    }

    const absPath = path.join(process.cwd(), 'lib/ai/skills', safeSkill, filePath);

    if (!fs.existsSync(absPath)) {
        return { success: false, message: `File not found: ${filePath}` };
    }

    try {
        const content = fs.readFileSync(absPath, 'utf-8');
        return { success: true, content };
    } catch (e) {
        return { success: false, message: "Failed to read file." };
    }
}

/**
 * Tool: List Resources
 * Lists available files in the references directory for a skill.
 */
export async function listResourcesTool(skillName: string) {
    const safeSkill = skillName.replace(/[^a-zA-Z0-9_-]/g, '');
    const refDir = path.join(process.cwd(), 'lib/ai/skills', safeSkill, 'references');

    if (!fs.existsSync(refDir)) {
        return { success: true, files: [] }; // No references is a valid state
    }

    try {
        const files = fs.readdirSync(refDir);
        return { success: true, files };
    } catch (e) {
        return { success: false, message: "Failed to list resources." };
    }
}
