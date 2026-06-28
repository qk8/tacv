import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectDependencies } from '../../../src/activities/scout/impl.js';

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'tacv-scout-deps-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('detectDependencies', () => {
  it('detects npm dependencies from package.json', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.18.0', lodash: '^4.17.21' },
        devDependencies: { vitest: '^1.0.0' },
      }));

      const deps = await detectDependencies(dir);
      const npmDeps = deps.filter(d => d.ecosystem === 'npm');
      expect(npmDeps).toHaveLength(3);
      expect(npmDeps.map(d => d.name)).toContain('express');
      expect(npmDeps.map(d => d.name)).toContain('vitest');
    } finally { cleanup(); }
  });

  it('detects Maven dependencies from pom.xml', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      writeFileSync(join(dir, 'pom.xml'), `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.20</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </dependency>
  </dependencies>
</project>`);

      const deps = await detectDependencies(dir);
      const mavenDeps = deps.filter(d => d.ecosystem === 'maven');
      expect(mavenDeps).toHaveLength(2);
      expect(mavenDeps.map(d => d.name)).toContain('org.springframework:spring-core');
      expect(mavenDeps.find(d => d.name === 'org.springframework:spring-core')?.version).toBe('5.3.20');
      expect(mavenDeps.find(d => d.name === 'com.fasterxml.jackson.core:jackson-databind')?.version).toBe('managed');
    } finally { cleanup(); }
  });

  it('detects Gradle dependencies from build.gradle', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      writeFileSync(join(dir, 'build.gradle'), `
dependencies {
    implementation 'org.springframework:spring-core:5.3.20'
    api 'com.google.guava:guava:31.1-jre'
    compileOnly 'javax.servlet:javax.servlet-api:4.0.1'
}`);

      const deps = await detectDependencies(dir);
      const gradleDeps = deps.filter(d => d.ecosystem === 'gradle');
      expect(gradleDeps).toHaveLength(3);
      expect(gradleDeps.map(d => d.name)).toContain('org.springframework:spring-core');
      expect(gradleDeps.find(d => d.name === 'com.google.guava:guava')?.version).toBe('31.1-jre');
    } finally { cleanup(); }
  });

  it('detects Python pip dependencies from requirements.txt', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      writeFileSync(join(dir, 'requirements.txt'), `flask==2.3.0
requests>=2.28.0
# comment
numpy==1.24.0`);

      const deps = await detectDependencies(dir);
      const pipDeps = deps.filter(d => d.ecosystem === 'pip');
      expect(pipDeps).toHaveLength(3);
      expect(pipDeps.map(d => d.name)).toContain('flask');
      expect(pipDeps.find(d => d.name === 'flask')?.version).toBe('2.3.0');
    } finally { cleanup(); }
  });

  it('returns no deps when no manifest files exist', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      const deps = await detectDependencies(dir);
      expect(deps).toHaveLength(0);
    } finally { cleanup(); }
  });
});
