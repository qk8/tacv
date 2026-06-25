export interface MemoryQuery {
  userId:    string;
  agentId:   string;
  text:      string;
  topK?:     number;
  filters?:  Record<string, unknown>;
}

export interface MemoryItem {
  id:       string;
  text:     string;
  metadata: Record<string, unknown>;
  score?:   number;
}

export interface IMemoryProvider {
  add(text: string, userId: string, agentId: string, metadata?: Record<string, unknown>): Promise<string>;
  search(query: MemoryQuery): Promise<MemoryItem[]>;
  getAll(userId: string, agentId: string): Promise<MemoryItem[]>;
  delete(id: string): Promise<void>;
  deleteAll(userId: string, agentId: string): Promise<void>;
}
