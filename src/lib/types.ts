export type ThemeMode = 'auto' | 'light' | 'dark';
export type OpenMode = 'tab' | 'same';

export interface PersistedView {
  folderId?: string;
  topId?: string;
  subId?: string;
}

export interface AiConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
}

export interface Prefs {
  rootId: string;
  openMode: OpenMode;
  theme: ThemeMode;
  font: string;
  view: PersistedView | null;
  expanded: string[] | null;
  favorites: string[];
  lastFolderId: string;
  ai: AiConfig;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  host: string;
  group: string;
  dateAdded: number;
  subText?: string;
}

export interface FolderNode {
  id: string;
  title: string;
  parentId: string;
  depth: number;
  items: BookmarkItem[];
  children: FolderNode[];
  totalCount: number;
}

export interface FlatFolder {
  id: string;
  title: string;
  parentTitle?: string;
  pathLabel: string;
  depth: number;
  isRoot?: boolean;
  hasChildren?: boolean;
  items: chrome.bookmarks.BookmarkTreeNode[];
}

export interface UrlInfo {
  ok: boolean;
  raw: string;
  cleanUrl: string;
  trimHash: string;
  origin: string;
  host: string;
  port: string;
  base: string;
  sub: string;
  isIp: boolean;
  rawPathname: string;
  pathname: string;
  search: string;
  path: string;
}

export interface PageKind {
  kind: 'site' | 'content';
  label: string;
}

export interface ExportBookmark {
  title: string;
  url: string;
}

export interface ExportFolder {
  title: string;
  items: ExportBookmark[];
  children?: ExportFolder[];
}

export interface ExportData {
  version: number;
  root: string;
  exportedAt: string;
  favorites: string[];
  loose: ExportBookmark[];
  folders: ExportFolder[];
}
