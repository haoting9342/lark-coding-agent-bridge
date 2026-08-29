import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAgentSkillsRoot } from '../../../department-runtime/bootstrap.mjs';

describe('department runtime skill root', () => {
  it('uses the Codex home configured for the active profile', () => {
    expect(resolveAgentSkillsRoot({
      agentKind: 'codex',
      profileRoot: '/state/profiles/main',
      codex: { codexHome: '/opt/codex-main' },
    })).toBe(path.join('/opt/codex-main', 'skills'));
  });

  it('uses the profile-private Codex home when user config is isolated', () => {
    expect(resolveAgentSkillsRoot({
      agentKind: 'codex',
      profileRoot: '/state/profiles/main',
      codex: { ignoreUserConfig: true },
    })).toBe(path.join('/state/profiles/main', 'codex-home', 'skills'));
  });
});
