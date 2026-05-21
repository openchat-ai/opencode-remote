import fs from 'fs';
import path from 'path';
import os from 'os';

class MemoryManager {
  constructor() {
    this.memoryDir = path.join(os.homedir(), '.opencode-remote', 'memory');
    this.userPrefsPath = path.join(this.memoryDir, 'user_preferences.json');
    this.projectKnowledgePath = path.join(this.memoryDir, 'project_knowledge.json');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    this.ensureFileExists(this.userPrefsPath);
    this.ensureFileExists(this.projectKnowledgePath);
  }

  ensureFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2));
    }
  }

  readMemory(type = 'prefs') {
    const filePath = type === 'prefs' ? this.userPrefsPath : this.projectKnowledgePath;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`Error reading memory ${type}:`, e);
      return { items: [] };
    }
  }

  saveMemory(type, item) {
    const filePath = type === 'prefs' ? this.userPrefsPath : this.projectKnowledgePath;
    const data = this.readMemory(type);
    
    const exists = data.items.find(i => i.content === item.content);
    if (!exists) {
      data.items.push({
        content: item.content,
        timestamp: new Date().toISOString(),
        tags: item.tags || []
      });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  deleteMemory(type, query) {
    const filePath = type === 'prefs' ? this.userPrefsPath : this.projectKnowledgePath;
    const data = this.readMemory(type);
    const originalCount = data.items.length;

    // 如果 query 是空，则清空所有
    if (!query) {
      data.items = [];
    } else {
      // 过滤掉包含 query 关键词的条目
      data.items = data.items.filter(item => !item.content.includes(query));
    }

    if (data.items.length !== originalCount) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    }
    return false;
  }

  getRelevantMemory(query) {
    const prefs = this.readMemory('prefs');
    const knowledge = this.readMemory('knowledge');
    
    const allItems = [...prefs.items, ...knowledge.items];
    const keywords = query.toLowerCase().split(/\s+/);
    
    return allItems.filter(item => 
      keywords.some(kw => item.content.toLowerCase().includes(kw))
    ).map(i => i.content).join('\n');
  }
}

export default new MemoryManager();
