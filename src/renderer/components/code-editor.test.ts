import { describe, expect, it } from 'vitest';
import { detectLanguage } from './code-editor.js';

describe('detectLanguage', () => {
  it('maps common extensions to languages', () => {
    expect(detectLanguage('/repo/src/app.ts')).not.toBeNull();
    expect(detectLanguage('/repo/src/app.tsx')).not.toBeNull();
    expect(detectLanguage('script.js')).not.toBeNull();
    expect(detectLanguage('main.py')).not.toBeNull();
    expect(detectLanguage('index.html')).not.toBeNull();
    expect(detectLanguage('style.css')).not.toBeNull();
    expect(detectLanguage('package.json')).not.toBeNull();
    expect(detectLanguage('README.md')).not.toBeNull();
    expect(detectLanguage('lib.rs')).not.toBeNull();
    expect(detectLanguage('main.go')).not.toBeNull();
    expect(detectLanguage('Main.java')).not.toBeNull();
    expect(detectLanguage('query.sql')).not.toBeNull();
    expect(detectLanguage('config.yaml')).not.toBeNull();
    expect(detectLanguage('Cargo.toml')).not.toBeNull();
    expect(detectLanguage('deploy.sh')).not.toBeNull();
    expect(detectLanguage('Program.cs')).not.toBeNull();
    expect(detectLanguage('App.vue')).not.toBeNull();
    expect(detectLanguage('Main.kt')).not.toBeNull();
    expect(detectLanguage('App.scala')).not.toBeNull();
    expect(detectLanguage('main.dart')).not.toBeNull();
  });

  it('handles extensions case-insensitively', () => {
    expect(detectLanguage('/repo/App.TS')).not.toBeNull();
    expect(detectLanguage('/repo/Main.PY')).not.toBeNull();
  });

  it('maps basename-based files', () => {
    expect(detectLanguage('/repo/Dockerfile')).not.toBeNull();
    expect(detectLanguage('/repo/Makefile')).not.toBeNull();
    expect(detectLanguage('/repo/CMakeLists.txt')).not.toBeNull();
    expect(detectLanguage('/repo/.env')).not.toBeNull();
  });

  it('returns null for unknown or extensionless files', () => {
    expect(detectLanguage('/repo/notes.xyz')).toBeNull();
    expect(detectLanguage('/repo/README')).toBeNull();
    expect(detectLanguage('/repo/LICENSE')).toBeNull();
  });
});
