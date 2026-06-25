export interface LibraryDoc {
  readonly library:   string;
  readonly version:   string;
  readonly summary:   string;
  readonly apiNotes:  string;
}

export interface ResolvedDocs {
  readonly libraries:     LibraryDoc[];
  readonly tokenEstimate: number;
}

export interface DetectedDependency {
  readonly name:      string;
  readonly version:   string;
  readonly ecosystem: 'npm' | 'maven' | 'gradle' | 'pip';
}

export interface ILibraryDocsProvider {
  resolve(dependencies: DetectedDependency[]): Promise<ResolvedDocs>;
  isEnabled(): boolean;
}
