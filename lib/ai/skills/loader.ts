import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// Helper to define what a Skill looks like in the registry (lightweight)
export interface SkillRegistryEntry {
    name: string;
    description: string;
}

// Helper to define loaded skill (heavyweight)
export interface LoadedSkill {
    name: string;
    description: string;
    instructions: string;
}

const SKILLS_DIR = path.join(process.cwd(), 'lib/ai/skills');

export class SkillLoader {
    /**
     * Scans the skills directory and returns a registry of available skills.
     * Reads the YAML frontmatter from SKILL.md files.
     */
    static getRegistry(): SkillRegistryEntry[] {
        const registry: SkillRegistryEntry[] = [];

        if (!fs.existsSync(SKILLS_DIR)) {
            return registry;
        }

        const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const dir of skillDirs) {
            const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
            if (fs.existsSync(skillPath)) {
                try {
                    const fileContent = fs.readFileSync(skillPath, 'utf-8');
                    const { data } = matter(fileContent);

                    if (data.name && data.description) {
                        registry.push({
                            name: data.name,
                            description: data.description
                        });
                    }
                } catch (e) {
                    console.error(`Failed to load skill from ${dir}`, e);
                }
            }
        }

        return registry;
    }

    /**
     * Loads the full instructions for a specific skill.
     */
    static loadSkill(skillName: string): LoadedSkill | null {
        // Security check: simple strict matching against registry scan or valid directory names
        // to prevent path traversal (though path.join is fairly safe, explicit check is better)
        const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, '');
        const skillPath = path.join(SKILLS_DIR, safeName, 'SKILL.md');

        if (!fs.existsSync(skillPath)) {
            return null;
        }

        try {
            const fileContent = fs.readFileSync(skillPath, 'utf-8');
            const { data, content } = matter(fileContent);

            return {
                name: data.name,
                description: data.description,
                instructions: content
            };
        } catch (e) {
            console.error(`Failed to load skill body for ${skillName}`, e);
            return null;
        }
    }
}
