import { promises as fs } from 'fs';
import matter from 'gray-matter';
import { FrontmatterSchema } from '../schemas/index.js';
/**
 * Parses a markdown file with YAML frontmatter.
 */
export async function readMarkdown(filePath) {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(fileContent);
    // Validate frontmatter with Zod
    const frontmatter = FrontmatterSchema.parse(data);
    return {
        frontmatter,
        content: content.trim(),
    };
}
/**
 * Writes a markdown file with YAML frontmatter.
 */
export async function writeMarkdown(filePath, frontmatter, content) {
    const fileContent = matter.stringify(content, frontmatter);
    await fs.writeFile(filePath, fileContent);
}
/**
 * Updates the frontmatter of an existing markdown file.
 */
export async function updateFrontmatter(filePath, updates) {
    const { frontmatter, content } = await readMarkdown(filePath);
    const updatedFrontmatter = { ...frontmatter, ...updates };
    await writeMarkdown(filePath, updatedFrontmatter, content);
}
/**
 * Creates a new markdown file with frontmatter.
 */
export async function createMarkdownFile(filePath, title, content, options = {}) {
    const today = new Date().toISOString().split('T')[0];
    const frontmatter = {
        title,
        created: today,
        tags: options.tags ?? [],
        ...options,
    };
    await writeMarkdown(filePath, frontmatter, content);
}
/**
 * Appends content to an existing markdown file.
 */
export async function appendToMarkdown(filePath, newContent) {
    const { frontmatter, content } = await readMarkdown(filePath);
    const updatedContent = content + '\n\n' + newContent;
    // Update modified date
    const updatedFrontmatter = {
        ...frontmatter,
        modified: new Date().toISOString().split('T')[0],
    };
    await writeMarkdown(filePath, updatedFrontmatter, updatedContent);
}
