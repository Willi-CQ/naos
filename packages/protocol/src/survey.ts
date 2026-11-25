/** On-demand project geography. File contents and absolute paths never enter a survey. */
export interface ProjectRegion {
  path: string;
  name: string;
  kind: 'source' | 'interface' | 'service' | 'tests' | 'docs' | 'assets' | 'config';
  files: number;
  entries: string[];
}

export interface ProjectSurvey {
  regions: ProjectRegion[];
  files: number;
  languages: Array<{ name: string; files: number }>;
  /** False means the bounded scan stopped before reaching every file. */
  complete: boolean;
}

export interface KnowledgeNode { id: string; title: string; folder: string }
export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: Array<{ from: string; to: string; kind: 'link' | 'folder' }>;
  complete: boolean;
}
