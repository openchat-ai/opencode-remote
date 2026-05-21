// Code viewer utilities for Weixin bot
// Uses OpenCode SDK file.status() API - no git dependency
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';

function getProjectRoot() {
    const candidates = [
        process.env.OPENCODE_PROJECT_ROOT,
        process.cwd(),
        process.env.HOME,
    ];
    for (const p of candidates) {
        if (p && existsSync(p)) {
            return p;
        }
    }
    return process.cwd();
}

// Get modified files from OpenCode session
export async function getModifiedFilesFromSession(session) {
    try {
        const result = await session.client.file.status({});
        if (result.error) {
            return [];
        }
        const files = result.data || [];
        return files.map(f => ({
            path: f.path,
            additions: f.additions || 0,
            deletions: f.deletions || 0,
            size: f.size || 0,
        }));
    }
    catch (error) {
        console.error('Failed to get modified files from session:', error.message);
        return [];
    }
}

// Fallback: scan directory for recently modified files
export function getModifiedFiles() {
    try {
        const root = getProjectRoot();
        const files = [];
        const now = Date.now();
        const oneHourAgo = now - 3600000;
        scanDir(root, root, oneHourAgo, files);
        files.sort((a, b) => b.mtime - a.mtime);
        return files.slice(0, 50).map(f => ({
            path: f.relativePath,
            additions: 0,
            deletions: 0,
            size: f.size,
            mtime: f.mtime,
        }));
    }
    catch (error) {
        console.error('Failed to get modified files:', error.message);
        return [];
    }
}

function scanDir(root, dir, cutoff, results, depth = 0) {
    if (depth > 10) return;
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                scanDir(root, fullPath, cutoff, results, depth + 1);
            }
            else if (entry.isFile()) {
                try {
                    const stat = statSync(fullPath);
                    if (stat.mtimeMs > cutoff) {
                        const relativePath = fullPath.substring(root.length + 1);
                        results.push({
                            relativePath,
                            size: stat.size,
                            mtime: stat.mtimeMs,
                        });
                    }
                }
                catch { /* ignore */ }
            }
        }
    }
    catch { /* ignore */ }
}

export function getFileContent(filePath, maxLines = 500) {
    try {
        const root = getProjectRoot();
        const fullPath = join(root, filePath);
        if (!existsSync(fullPath)) {
            return { error: `File not found: ${filePath}` };
        }
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const truncated = lines.length > maxLines;
        const displayLines = truncated ? lines.slice(0, maxLines) : lines;
        const numbered = displayLines.map((line, i) => `${String(i + 1).padStart(4)}: ${line}`).join('\n');
        return {
            path: filePath,
            content: numbered,
            totalLines: lines.length,
            truncated,
            extension: extname(filePath).slice(1),
        };
    }
    catch (error) {
        return { error: `Failed to read file: ${error.message}` };
    }
}

export function getFileDiff(filePath) {
    try {
        const root = getProjectRoot();
        const fullPath = join(root, filePath);
        if (!existsSync(fullPath)) {
            return { path: filePath, diff: `File not found: ${filePath}` };
        }
        const content = readFileSync(fullPath, 'utf-8');
        return { path: filePath, diff: content };
    }
    catch {
        return { path: filePath, diff: '(unable to read file)' };
    }
}

export function getAllDiffs() {
    const files = getModifiedFiles();
    if (files.length === 0) {
        return '(no recently modified files found)';
    }
    const root = getProjectRoot();
    let result = '';
    for (const f of files.slice(0, 10)) {
        const fullPath = join(root, f.path);
        if (existsSync(fullPath)) {
            const content = readFileSync(fullPath, 'utf-8');
            result += `===== ${f.path} =====\n${content}\n\n`;
        }
    }
    return result || '(unable to read files)';
}

function parseMdSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = { title: 'Introduction', content: [], level: 0 };
    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            if (currentSection.content.length > 0) {
                sections.push({ ...currentSection, content: currentSection.content.join('\n') });
            }
            currentSection = {
                title: headingMatch[2].trim(),
                content: [],
                level: headingMatch[1].length,
            };
        }
        else {
            currentSection.content.push(line);
        }
    }
    if (currentSection.content.length > 0) {
        sections.push({ ...currentSection, content: currentSection.content.join('\n') });
    }
    return sections;
}

function scoreRelevance(section, keywords) {
    const text = `${section.title} ${section.content}`.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
        const lower = keyword.toLowerCase();
        if (text.includes(lower)) {
            score += 10;
            if (section.title.toLowerCase().includes(lower)) {
                score += 20;
            }
        }
    }
    return score;
}

export function getRelevantMdSections(filePath, keywords, maxSections = 5) {
    try {
        const root = getProjectRoot();
        const fullPath = join(root, filePath);
        if (!existsSync(fullPath)) {
            return { error: `File not found: ${filePath}` };
        }
        const content = readFileSync(fullPath, 'utf-8');
        const sections = parseMdSections(content);
        if (keywords.length === 0) {
            const preview = sections.slice(0, maxSections).map((s, i) => ({
                index: i + 1,
                title: s.title,
                content: s.content.length > 300 ? s.content.slice(0, 300) + '...' : s.content,
            }));
            return { path: filePath, sections: preview, totalSections: sections.length };
        }
        const scored = sections
            .map((s, i) => ({ ...s, index: i + 1, score: scoreRelevance(s, keywords) }))
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSections);
        if (scored.length === 0) {
            const preview = sections.slice(0, maxSections).map((s, i) => ({
                index: i + 1,
                title: s.title,
                content: s.content.length > 300 ? s.content.slice(0, 300) + '...' : s.content,
            }));
            return { path: filePath, sections: preview, totalSections: sections.length };
        }
        return {
            path: filePath,
            sections: scored.map(s => ({
                index: s.index,
                title: s.title,
                content: s.content.length > 500 ? s.content.slice(0, 500) + '...' : s.content,
                score: s.score,
            })),
            totalSections: sections.length,
        };
    }
    catch (error) {
        return { error: `Failed to read MD file: ${error.message}` };
    }
}

export function findMdFiles() {
    try {
        const root = getProjectRoot();
        const files = [];
        scanMdFiles(root, root, files, 0);
        return files;
    }
    catch {
        return [];
    }
}

function scanMdFiles(root, dir, results, depth) {
    if (depth > 8) return;
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                scanMdFiles(root, fullPath, results, depth + 1);
            }
            else if (entry.isFile() && /\.(md|MD|markdown)$/i.test(entry.name)) {
                const relativePath = fullPath.replace(root + '\\', '').replace(root + '/', '');
                results.push(relativePath);
            }
        }
    }
    catch { /* ignore */ }
}
