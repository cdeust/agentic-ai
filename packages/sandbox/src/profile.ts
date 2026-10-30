import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { SandboxError } from './port.js';

/**
 * Gabarit de profil : un fichier descriptif `profiles/<nom>.json`. Le bloc `srt` est un fichier de réglages srt
 * dont les chemins portent des variables ; `env` est la liste fermée de l'environnement transmis.
 *
 * Schéma strict à tous les niveaux (§5) : srt tolère une clé mal écrite [T-01], et les options d'affaiblissement
 * (`allowAllUnixSockets`, `enableWeakerNestedSandbox`, `allowNestedUserNamespaces`, `allowLocalBinding`,
 * `filesystem.disabled`, `allowGitConfig`, ...) sont refusées faute d'être dans le schéma (§4.1 E).
 * Noms des clés srt : node_modules/@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-config.js
 * (`NetworkConfigSchema`, `FilesystemConfigSchema`, `allowPty`).
 */
const PathList = z.array(z.string().min(1));

export const SrtSettingsSchema = z.strictObject({
  network: z.strictObject({
    allowedDomains: z.array(z.string().min(1)),
    deniedDomains: z.array(z.string().min(1)),
  }),
  filesystem: z.strictObject({
    denyRead: PathList,
    allowRead: PathList.optional(),
    allowWrite: PathList,
    denyWrite: PathList,
  }),
  allowPty: z.boolean().optional(),
});
export type SrtSettings = z.infer<typeof SrtSettingsSchema>;

/** Variables jamais transmises : clé ou jeton (le compte vient du trousseau, pas de l'environnement), répertoire
 * de configuration (le compte du propriétaire est utilisé tel quel), proxy (srt fixe le sien ; `NO_PROXY`
 * contournerait le proxy [T-03, T-41]), injection de code dans node. */
const FORBIDDEN_ENV =
  /^(ANTHROPIC_.*|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH.*|NO_PROXY|HTTPS?_PROXY|ALL_PROXY|NODE_OPTIONS)$/i;
const EnvName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .refine((name) => !FORBIDDEN_ENV.test(name), { message: 'variable interdite' });

export const ProfileTemplateSchema = z.strictObject({
  description: z.string().min(1),
  srt: SrtSettingsSchema,
  env: z.strictObject({
    pass: z.array(EnvName),
    set: z.record(z.string(), z.string()).superRefine((set, ctx) => {
      for (const name of Object.keys(set))
        if (!EnvName.safeParse(name).success) ctx.addIssue({ code: 'custom', message: `variable ${name}` });
    }),
  }),
});
export type ProfileTemplate = z.infer<typeof ProfileTemplateSchema>;

export const PROFILE_VARIABLES = ['home', 'repo', 'worktree', 'worktreeName', 'tmp'] as const;
export type ProfileVariables = Record<(typeof PROFILE_VARIABLES)[number], string>;

export interface ResolvedProfile {
  readonly settings: SrtSettings;
  readonly env: { readonly pass: readonly string[]; readonly set: Readonly<Record<string, string>> };
}

const PROFILE_NAME = /^[a-z][a-z0-9-]*$/;

export function loadTemplate(profilesDir: string, name: string): ProfileTemplate {
  if (!PROFILE_NAME.test(name)) throw new SandboxError('PROFILE_INVALID', `nom de profil refusé : ${name}`);
  const file = join(profilesDir, `${name}.json`);
  if (!existsSync(file)) throw new SandboxError('PROFILE_INVALID', `profil inconnu : ${name}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new SandboxError('PROFILE_INVALID', `${name}.json n'est pas du JSON`);
  }
  return parseTemplate(raw, name);
}

export function parseTemplate(raw: unknown, name = 'gabarit'): ProfileTemplate {
  const parsed = ProfileTemplateSchema.safeParse(raw);
  if (!parsed.success) throw new SandboxError('PROFILE_INVALID', `${name} : ${parsed.error.message}`);
  return parsed.data;
}

function substitute(value: string, vars: ProfileVariables): string {
  return value.replace(/\$\{([A-Za-z]+)\}/g, (_, key: string) => {
    if (!(PROFILE_VARIABLES as readonly string[]).includes(key))
      throw new SandboxError('PROFILE_INVALID', `variable inconnue : \${${key}}`);
    return vars[key as keyof ProfileVariables];
  });
}

/** Résout les variables ; chaque chemin résolu doit être absolu. */
export function resolveProfile(template: ProfileTemplate, vars: ProfileVariables): ResolvedProfile {
  for (const [key, value] of Object.entries(vars))
    if (!isAbsolute(value) && key !== 'worktreeName')
      throw new SandboxError('PROFILE_INVALID', `variable ${key} non absolue`);
  const paths = (list: readonly string[]) =>
    list.map((entry) => {
      const resolved = substitute(entry, vars);
      if (!isAbsolute(resolved)) throw new SandboxError('PROFILE_INVALID', `chemin non absolu : ${entry}`);
      return resolved;
    });
  const fs = template.srt.filesystem;
  const settings: SrtSettings = {
    ...template.srt,
    filesystem: {
      denyRead: paths(fs.denyRead),
      ...(fs.allowRead ? { allowRead: paths(fs.allowRead) } : {}),
      allowWrite: paths(fs.allowWrite),
      denyWrite: paths(fs.denyWrite),
    },
  };
  const set = Object.fromEntries(Object.entries(template.env.set).map(([k, v]) => [k, substitute(v, vars)]));
  return { settings: SrtSettingsSchema.parse(settings), env: { pass: template.env.pass, set } };
}

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** Vrai si la sandbox peut écrire `path` : sous un `allowWrite` et sous aucun `denyWrite`. Chemins réels attendus. */
export function isWritable(settings: SrtSettings, path: string): boolean {
  const { allowWrite, denyWrite } = settings.filesystem;
  return allowWrite.some((root) => under(path, root)) && !denyWrite.some((root) => under(path, root));
}

/** Environnement en liste fermée : les noms de `pass` copiés depuis l'hôte, puis `set`. */
export function closedEnv(
  profile: ResolvedProfile,
  host: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of profile.env.pass) {
    const value = host[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...profile.env.set };
}
