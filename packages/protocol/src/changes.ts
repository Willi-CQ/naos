export interface ProjectChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
  unstaged: boolean;
  additions: number | null;
  deletions: number | null;
}

export interface ProjectChanges {
  available: boolean;
  branch: string | null;
  files: ProjectChange[];
  additions: number;
  deletions: number;
  updatedAt: number;
  message?: string;
}

export interface ProjectDiff {
  path: string;
  status: ProjectChange['status'];
  patch: string;
  truncated: boolean;
  binary: boolean;
}
